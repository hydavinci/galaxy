/** Demand-driven planet images. All GL work is confined to update()/dispose(). */
import { assetUrl } from './assets';
import type { CameraState } from './types';

export type PlanetTextureTier = 2 | 4 | 8;
export interface PlanetTextureDemand {
  id: string; devicePixelDiameter: number;
  /** True projected centre in NDC; distinguishes locked tracking from a slow
   * but many-pixels-per-frame pan in a sub-arcsecond optical window. */
  screenPosition?: readonly [number, number];
}
export interface ReadyPlanetTexture { texture: WebGLTexture; ready: boolean; /** Kilopixels of source width (2, 4, 8). */ tier: PlanetTextureTier; }
export type PlanetTextureSources = Readonly<Record<string, Partial<Record<PlanetTextureTier,string>>>>;
export interface PlanetTextureOptions {
  /** Explicit allowlist replaces legacy assets, never merges/falls back. Empty disables image maps. */
  sources?: PlanetTextureSources;
  imageFactory?: () => HTMLImageElement;
  /** Capability overrides for deterministic tests; budgets can only lower the hard caps. */
  deviceMemoryGiB?: number;
  mobile?: boolean;
  gpuBudgetBytes?: number;
  maxConcurrentBaseLoads?: number;
  stableMs?: number;
  loadTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  detailIdleMs?: number;
  baseIdleMs?: number;
}
export interface PlanetTextureStats {
  ready: number; baseReady: number; detailReady: number;
  loading: number; baseLoading: number; hdLoading: number; decoding: number; decoded: number; draining: number;
  requested: number; uploads: number; cancelled: number; failuresTotal: number; failed: number; timeouts: number; evictions: number;
  gpuBytes: number; reservedBytes: number; peakGpuBytes: number; budgetBytes: number;
  maxTextureSize: number; maxTier: number; maxConcurrentBaseLoads: number; stable: boolean;
  disposed: boolean; contextLost: boolean;
}
interface Asset { tiers: readonly PlanetTextureTier[]; stem: string; ring?: boolean; urls?: Partial<Record<PlanetTextureTier,string>>; }
const ASSETS: ReadonlyMap<string, Asset> = new Map([
  // Inspect decoded dimensions, not the source site's nominal file names:
  // its '8k' Sun/Jupiter/Saturn downloads are actually 4096x2048.
  ...['moon', 'mercury', 'mars'].map(id => [id, { tiers: [2, 4, 8], stem: id }] as [string, Asset]),
  ...['sun', 'jupiter', 'saturn'].map(id => [id, { tiers: [2, 4], stem: id }] as [string, Asset]),
  ['venus', { tiers: [2, 4], stem: 'venus_atmosphere' }],
  ['uranus', { tiers: [2], stem: 'uranus' }], ['neptune', { tiers: [2], stem: 'neptune' }],
  ['saturn-ring', { tiers: [2, 8], stem: 'saturn_ring_alpha', ring: true }],
  ['earth', { tiers: [2, 4, 8], stem: 'earth_daymap' }],
]);
const MiB = 1024 * 1024;
const RAD = Math.PI / 180;
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;
}
/** RGBA8 storage, including every mip level, even for non-power-of-two ring heights. */
function mipBytes(width: number, height: number): number {
  let bytes = 0;
  for (;;) {
    bytes += width * height * 4;
    if (width === 1 && height === 1) return bytes;
    width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
  }
}
function expectedBytes(asset:Asset, tier: PlanetTextureTier): number {
  return mipBytes(tier * 1024, tier * (asset.ring ? 64 : 512));
}
function url(id: string, tier: PlanetTextureTier,asset:Asset): string {
  if(asset.urls)return assetUrl(asset.urls[tier]!);
  return assetUrl(`./textures/${tier > 2 || id === 'venus' || asset.ring ? 'detail/' : ''}${tier}k_${asset.stem}.${asset.ring ? 'png' : 'jpg'}`);
}
interface Resident extends ReadyPlanetTexture { id: string; bytes: number; lastUsed: number; }
interface Failure { attempts: number; retryAt: number; }
interface Request {
  key: string; id: string; tier: PlanetTextureTier; image: HTMLImageElement; started: number; bytes: number;
  phase: 'loading' | 'decoding' | 'decoded' | 'failed'; cancelled: boolean; permanent?: boolean;
}

export class PlanetTextureManager {
  private readonly assets:ReadonlyMap<string,Asset>;
  private readonly imageFactory: () => HTMLImageElement;
  private readonly budget: number;
  private readonly maxSize: number;
  private readonly maxTier: PlanetTextureTier;
  private readonly maxBase: number;
  private readonly stableMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly detailIdleMs: number;
  private readonly baseIdleMs: number;
  private readonly residents = new Map<string, Resident>();
  private readonly requests = new Map<string, Request>();
  // Image.decode() has no AbortSignal. A cancelled decode retains its slot until
  // settlement, even after a timeout, rather than accumulating orphaned 8k decoders.
  private readonly decoders = new Set<Request>();
  private readonly failures = new Map<string, Failure>();
  private demands = new Map<string, number>();
  private wanted = new Map<string, PlanetTextureTier>();
  private now = 0;
  private initialized = false;
  private disposed = false;
  private lost = false;
  private stable = false;
  private stableSince = 0;
  private camera?: CameraState;
  private anchorFov = 0;
  private anchorDiameter = 0;
  private anchorPosition?: readonly [number, number];
  private focus = '';
  private motionAt = 0;
  private velocity?: [number, number];
  private gpuBytes = 0;
  private peakGpuBytes = 0;
  private requested = 0;
  private uploads = 0;
  private cancelled = 0;
  private failuresTotal = 0;
  private timeouts = 0;
  private evictions = 0;

  constructor(private readonly gl: WebGL2RenderingContext, options: PlanetTextureOptions = {}) {
    if(options.sources===undefined)this.assets=ASSETS;
    else {
      const entries:Array<[string,Asset]>=[];
      for(const [id,paths] of Object.entries(options.sources)){
        const tiers=([2,4,8] as PlanetTextureTier[]).filter(t=>typeof paths[t]==='string'&&/^\.\/observations\/maps\/[^?#]+$/.test(paths[t]!));
        if(!tiers.includes(2))continue;
        entries.push([id,{stem:id,tiers,urls:Object.fromEntries(tiers.map(t=>[t,paths[t]]))}]);
      }
      this.assets=new Map(entries);
    }
    const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
    const memory = options.deviceMemoryGiB ?? nav?.deviceMemory;
    const touch = options.mobile ?? ((nav?.maxTouchPoints ?? 0) > 0 || /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent ?? ''));
    // Unknown memory is deliberately conservative (including browsers that hide deviceMemory).
    const limited = touch || !Number.isFinite(memory) || memory! < 8;
    const hardCap = (limited ? 64 : 256) * MiB;
    this.budget = Math.floor(bounded(options.gpuBudgetBytes, hardCap, 0, hardCap));
    let size = 0;
    try { const value = gl.getParameter(gl.MAX_TEXTURE_SIZE); if (Number.isFinite(value)) size = Math.max(0, Math.floor(value)); } catch { /* no uploads on an unavailable context */ }
    this.maxSize = size;
    this.maxTier = !limited && size >= 8192 ? 8 : size >= 4096 ? 4 : 2;
    this.maxBase = Math.floor(bounded(options.maxConcurrentBaseLoads, 2, 1, 2));
    this.stableMs = bounded(options.stableMs, 350, 100, 2000);
    this.timeoutMs = bounded(options.loadTimeoutMs, 15000, 100, 60000);
    this.maxRetries = Math.floor(bounded(options.maxRetries, 2, 0, 2));
    this.retryDelay = bounded(options.retryDelayMs, 1000, 100, 30000);
    this.detailIdleMs = bounded(options.detailIdleMs, 30000, 0, 120000);
    this.baseIdleMs = bounded(options.baseIdleMs, 300000, 0, 900000);
    this.imageFactory = options.imageFactory ?? (() => new Image());
  }

  /** Call once per rendered frame with its monotonic millisecond timestamp.
   * Constructor/get never fetch, decode, allocate or upload. First frame is base-only.
   * Equal timestamps are ignored, preventing duplicate upload work in the same frame.
   */
  update(camera: CameraState, demands: PlanetTextureDemand[], now: number): void {
    if (this.disposed || this.lost) return;
    if (this.gl.isContextLost()) { this.contextLost(); return; }
    const time = Number.isFinite(now) ? Math.max(this.now, now) : this.now;
    if (this.initialized && time === this.now) return;
    const first = !this.initialized;
    const previousTime = this.now;
    this.now = time;
    this.demands = new Map();
    const positions = new Map<string, readonly [number, number]>();
    for (const demand of demands) {
      if (this.assets.has(demand.id) && Number.isFinite(demand.devicePixelDiameter) && demand.devicePixelDiameter > 0) {
        this.demands.set(demand.id, Math.max(this.demands.get(demand.id) ?? 0, demand.devicePixelDiameter));
        if (demand.screenPosition?.every(Number.isFinite)) positions.set(demand.id, demand.screenPosition);
      }
    }
    this.updateStability(camera, previousTime, first, positions);
    this.initialized = true;
    this.wanted = new Map([...this.demands].map(([id, diameter]) => [id, this.desiredTier(id, diameter)]));
    for (const resident of this.residents.values()) {
      if (this.demands.has(resident.id) && (resident.tier === 2 || resident.tier <= this.wanted.get(resident.id)!)) resident.lastUsed = this.now;
    }
    // Cancellation precedes the decoded queue. A stale decode can never upload
    // during a zoom, a focus change or a frame in which its target disappeared.
    for (const request of [...this.requests.values()]) {
      if (!this.demands.has(request.id) || (request.tier > 2 && (!this.stable || request.tier > this.wanted.get(request.id)!))) {
        this.cancel(request); continue;
      }
      if (request.phase === 'failed') this.fail(request, !!request.permanent);
      else if (request.phase !== 'decoded' && this.now - request.started >= this.timeoutMs) {
        this.timeouts++; this.fail(request);
      }
    }
    this.expire();
    const decoded = [...this.requests.values()].filter(r => r.phase === 'decoded')
      .sort((a, b) => Number(a.tier > 2) - Number(b.tier > 2) || (this.demands.get(b.id)! - this.demands.get(a.id)!));
    if (decoded[0]) this.upload(decoded[0]); // at most ONE texImage2D + mip chain per frame, including failures
    if (this.disposed || this.lost) return;
    const ordered = [...this.demands].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [id] of ordered) {
      if (this.baseSlots() >= this.maxBase) break;
      if (!this.residents.has(`${id}/2`)) this.start(id, 2);
    }
    if (!first && this.stable && this.detailSlots() === 0) {
      for (const [id] of ordered) {
        // If the preferred tier fails/backoffs/does not fit, try the next usable
        // one. Existing good images remain resident through every failed upgrade.
        const ready = this.get(id)?.tier ?? 0;
        const tiers = [...this.assets.get(id)!.tiers].reverse();
        for (const tier of tiers) {
          if (tier > 2 && tier > ready && tier <= this.wanted.get(id)! && this.start(id, tier)) return;
        }
      }
    }
  }

  get(id: string): ReadyPlanetTexture | undefined {
    if (this.disposed || this.lost) return undefined;
    for (const tier of [8, 4, 2]) {
      const resident = this.residents.get(`${id}/${tier}`);
      if (resident) return { texture: resident.texture, ready: true, tier: resident.tier };
    }
    return undefined;
  }

  getStats(): PlanetTextureStats {
    const active = [...this.requests.values()];
    const baseReady = [...this.residents.values()].filter(r => r.tier === 2).length;
    return {
      ready: this.residents.size, baseReady, detailReady: this.residents.size - baseReady,
      loading: active.length, baseLoading: active.filter(r => r.tier === 2).length,
      hdLoading: active.filter(r => r.tier > 2).length, decoding: this.decoders.size,
      decoded: active.filter(r => r.phase === 'decoded').length,
      draining: [...this.decoders].filter(r => r.cancelled).length,
      requested: this.requested, uploads: this.uploads, cancelled: this.cancelled,
      failuresTotal: this.failuresTotal, failed: [...this.failures.values()].filter(f => f.attempts > this.maxRetries).length,
      timeouts: this.timeouts, evictions: this.evictions, gpuBytes: this.gpuBytes,
      reservedBytes: this.reservedBytes(), peakGpuBytes: this.peakGpuBytes, budgetBytes: this.budget,
      maxTextureSize: this.maxSize, maxTier: this.maxTier, maxConcurrentBaseLoads: this.maxBase,
      stable: this.stable, disposed: this.disposed, contextLost: this.lost,
    };
  }

  /** Lost GL names must not be deleted or reused. Restoration needs a new manager. */
  contextLost(): void {
    if (this.lost) return;
    this.lost = true; this.invalidate(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate(!this.lost && !this.gl.isContextLost());
  }

  private invalidate(deleteTextures: boolean): void {
    for (const request of [...this.requests.values()]) this.cancel(request);
    this.decoders.clear();
    if (deleteTextures) for (const resident of this.residents.values()) this.gl.deleteTexture(resident.texture);
    this.residents.clear(); this.failures.clear(); this.demands.clear(); this.wanted.clear();
    this.gpuBytes = 0; this.stable = false;
  }

  private desiredTier(id: string, diameter: number): PlanetTextureTier {
    // Equirectangular width covers 360°, not the visible disk: only half its
    // longitudes are visible, and centre sampling is approximately width / pi
    // texels per projected diameter. 900/1800 device pixels are practical
    // upgrade thresholds (2k/4k have ~652/1304 centre samples), not 2k/4k CSS px.
    const target = diameter >= 1800 ? 8 : diameter >= 900 ? 4 : 2;
    return [...this.assets.get(id)!.tiers].reverse().find(t => t <= target && t <= this.maxTier && t * 1024 <= this.maxSize) ?? 2;
  }

  private updateStability(camera: CameraState, previousTime: number, first: boolean, positions: Map<string, readonly [number, number]>): void {
    const sorted = [...this.demands].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const focus = sorted[0]?.[0] ?? '';
    const diameter = sorted[0]?.[1] ?? 0;
    const valid = Number.isFinite(camera.azimuthDeg) && Number.isFinite(camera.altitudeDeg) && Number.isFinite(camera.fovDeg) && camera.fovDeg > 0 && camera.fovDeg < 180;
    const position = positions.get(focus);
    let changed = first || !valid || focus !== this.focus;
    if (position && (!this.anchorPosition || Math.hypot(position[0] - this.anchorPosition[0], position[1] - this.anchorPosition[1]) > .002)) changed = true;
    if (!changed && this.camera) {
      const dt = Math.max(1, this.now - previousTime) / 1000;
      const da = (((camera.azimuthDeg - this.camera.azimuthDeg) % 360 + 540) % 360 - 180);
      const dx = da * Math.cos((camera.altitudeDeg + this.camera.altitudeDeg) * RAD / 2);
      const dy = camera.altitudeDeg - this.camera.altitudeDeg;
      const field = 2 * Math.tan(Math.min(camera.fovDeg, this.camera.fovDeg) * RAD / 2) / RAD;
      const motion = Math.hypot(dx, dy);
      if (motion > 1e-12) {
        const elapsed = Math.max(1, this.now - this.motionAt) / 1000;
        const velocity: [number, number] = [dx / elapsed, dy / elapsed];
        // Most motion is judged in image/FOV units. Stable low-rate, coherent
        // tracking is exempt: at sub-arcsecond fields Earth's rotation can move
        // many fields between the application's 250ms ephemeris samples.
        // The renderer also supplies the true screen position, so a coherent
        // pan still resets the stable window above; locked tracking does not.
        const coherentTracking = this.velocity !== undefined && Math.hypot(...velocity) <= .02 &&
          Math.hypot(velocity[0] - this.velocity[0], velocity[1] - this.velocity[1]) <= Math.max(field * .02, Math.hypot(...this.velocity) * .2);
        if (motion / field > .05 * dt && !coherentTracking) changed = true;
        this.velocity = velocity; this.motionAt = this.now;
      }
      // Compare to the stable-window anchor, so many tiny zoom steps accumulate.
      if (Math.abs(Math.log(camera.fovDeg / this.anchorFov)) > .005 ||
          (this.anchorDiameter > 0 && Math.abs(Math.log(diameter / this.anchorDiameter)) > .02)) changed = true;
    }
    if (changed) {
      this.stableSince = this.now; this.anchorFov = camera.fovDeg; this.anchorDiameter = diameter; this.anchorPosition = position ? [...position] : undefined;
      if (first || focus !== this.focus || !valid || (this.camera && Math.abs(Math.log(camera.fovDeg / this.camera.fovDeg)) > .005)) {
        this.velocity = undefined; this.motionAt = this.now;
      }
    }
    this.camera = { ...camera }; this.focus = focus;
    this.stable = !first && valid && !!focus && this.now - this.stableSince >= this.stableMs;
  }

  private baseSlots(): number {
    return [...this.requests.values()].filter(r => r.tier === 2).length + [...this.decoders].filter(r => r.cancelled && r.tier === 2).length;
  }
  private detailSlots(): number {
    return [...this.requests.values()].filter(r => r.tier > 2).length + [...this.decoders].filter(r => r.cancelled && r.tier > 2).length;
  }
  private reservedBytes(except?: Request): number {
    let bytes = 0;
    for (const request of this.requests.values()) if (request !== except) bytes += request.bytes;
    return bytes;
  }
  private eligibleEvictions(protectedId: string): Resident[] {
    return [...this.residents.values()].filter(r => r.id !== protectedId &&
      (!this.demands.has(r.id) || (r.tier > 2 && r.tier > (this.wanted.get(r.id) ?? 2))))
      .sort((a, b) => Number(this.demands.has(a.id)) - Number(this.demands.has(b.id)) ||
        Number(a.tier === 2) - Number(b.tier === 2) || a.lastUsed - b.lastUsed);
  }
  private makeRoom(bytes: number, id: string, except?: Request): boolean {
    const total = this.gpuBytes + this.reservedBytes(except) + bytes;
    if (total <= this.budget) return true;
    const victims = this.eligibleEvictions(id);
    // Do not evict anything speculatively when even all candidates cannot help.
    if (total - victims.reduce((n, r) => n + r.bytes, 0) > this.budget) return false;
    for (const resident of victims) {
      this.remove(resident);
      if (this.gpuBytes + this.reservedBytes(except) + bytes <= this.budget) return true;
    }
    return false;
  }
  private remove(resident: Resident): void {
    this.gl.deleteTexture(resident.texture);
    this.residents.delete(`${resident.id}/${resident.tier}`);
    this.gpuBytes -= resident.bytes; this.evictions++;
  }
  private expire(): void {
    for (const resident of [...this.residents.values()]) {
      const inactive = !this.demands.has(resident.id) || (resident.tier > 2 && resident.tier > (this.wanted.get(resident.id) ?? 2));
      if (inactive && this.now - resident.lastUsed >= (resident.tier > 2 ? this.detailIdleMs : this.baseIdleMs)) this.remove(resident);
    }
  }

  private start(id: string, tier: PlanetTextureTier): boolean {
    const key = `${id}/${tier}`;
    const failure = this.failures.get(key);
    if (tier * 1024 > this.maxSize || tier > this.maxTier || this.residents.has(key) || this.requests.has(key) ||
        (failure && (failure.attempts > this.maxRetries || this.now < failure.retryAt))) return false;
    // A detail upgrade waits for the base to succeed or exhaust its bounded
    // retries; it never competes with that same body's initial base transfer.
    if (tier > 2 && !this.get(id) && (this.failures.get(`${id}/2`)?.attempts ?? 0) <= this.maxRetries) return false;
    const bytes = expectedBytes(this.assets.get(id)!, tier);
    if (!this.makeRoom(bytes, id)) return false;
    let image: HTMLImageElement;
    try { image = this.imageFactory(); } catch { this.recordFailure(key, false); return false; }
    const request: Request = { key, id, tier, image, started: this.now, bytes, phase: 'loading', cancelled: false };
    this.requests.set(key, request); this.requested++;
    image.onload = () => {
      if (!this.current(request) || request.phase !== 'loading') return;
      image.onload = null; image.onerror = null;
      if (!this.validDimensions(request)) { request.phase = 'failed'; request.permanent = true; return; }
      request.phase = 'decoding'; this.decoders.add(request);
      Promise.resolve().then(() => {
        if (this.current(request)) return image.decode?.();
      }).then(() => {
        this.decoders.delete(request);
        if (!this.current(request)) return;
        if (this.validDimensions(request)) request.phase = 'decoded';
        else { request.phase = 'failed'; request.permanent = true; }
      }, () => {
        this.decoders.delete(request);
        if (this.current(request)) request.phase = 'failed';
      });
    };
    image.onerror = () => { if (this.current(request) && request.phase === 'loading') request.phase = 'failed'; };
    try { image.decoding = 'async'; image.src = url(id, tier,this.assets.get(id)!); }
    catch { request.phase = 'failed'; }
    return true;
  }
  private current(request: Request): boolean {
    return !this.disposed && !this.lost && !request.cancelled && this.requests.get(request.key) === request;
  }
  private validDimensions(request: Request): boolean {
    const width = request.image.naturalWidth, height = request.image.naturalHeight;
    // SSS ring originals are 2048x125 / 8192x500; also accept explicitly padded
    // 128/512 strips, never a square/spherical image or an arbitrary huge decode.
    const validHeight = this.assets.get(request.id)!.ring ? [request.tier * 62.5, request.tier * 64].includes(height) : height === request.tier * 512;
    return width === request.tier * 1024 && validHeight && width <= this.maxSize && height <= this.maxSize;
  }
  private release(request: Request): void {
    this.requests.delete(request.key); request.cancelled = true;
    request.image.onload = null; request.image.onerror = null;
    try { request.image.src = ''; } catch { /* cancellation is best effort */ }
  }
  private cancel(request: Request): void { this.cancelled++; this.release(request); }
  private recordFailure(key: string, permanent: boolean): void {
    const attempts = permanent ? this.maxRetries + 1 : (this.failures.get(key)?.attempts ?? 0) + 1;
    this.failures.set(key, { attempts, retryAt: this.now + this.retryDelay * 2 ** (attempts - 1) });
    this.failuresTotal++;
  }
  private fail(request: Request, permanent = false): void {
    this.recordFailure(request.key, permanent); this.release(request);
  }

  private upload(request: Request): void {
    if (!this.validDimensions(request)) { this.fail(request, true); return; }
    const bytes = mipBytes(request.image.naturalWidth, request.image.naturalHeight);
    if (!this.makeRoom(bytes, request.id, request)) return;
    const gl = this.gl;
    let texture: WebGLTexture | null = null;
    let allocated = false;
    let success = false;
    const unpack: Array<[number, number | boolean]> = [];
    let active: number | undefined, binding: WebGLTexture | null = null, buffer: WebGLBuffer | null = null;
    let captured = false;
    // WebGL error flags are sticky; drain a bounded number of pre-existing flags
    // before attribution. Never spin on a lost context or a broken GL wrapper.
    const cleanErrors = (): boolean => {
      for (let i = 0; i < 16; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) return true;
        if (error === gl.CONTEXT_LOST_WEBGL || !Number.isFinite(error)) return false;
      }
      return false;
    };
    try {
      if (!cleanErrors()) throw new Error('Unusable GL error state');
      active = gl.getParameter(gl.ACTIVE_TEXTURE);
      binding = gl.getParameter(gl.TEXTURE_BINDING_2D);
      buffer = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
      for (const name of [gl.UNPACK_ALIGNMENT, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
        gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT,
        gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) unpack.push([name, gl.getParameter(name)]);
      captured = true;
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      for (const [name] of unpack) gl.pixelStorei(name, name === gl.UNPACK_ALIGNMENT ? 1 : 0);
      texture = gl.createTexture();
      if (!texture) throw new Error('Texture allocation failed');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Reserve the complete new mip chain while OLD good images are still alive.
      this.gpuBytes += bytes; allocated = true;
      this.peakGpuBytes = Math.max(this.peakGpuBytes, this.gpuBytes);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, request.image);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Texture upload failed');
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.assets.get(request.id)!.ring ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Texture mipmap/filter setup failed');
      success = true;
    } catch { /* failed replacements never publish a GL name */ }
    finally {
      if (captured) {
        // Restore every unpack input that affects DOM-source uploads, plus the
        // PBO and the binding on the caller's active unit (no unit-0 assumption).
        try {
          for (const [name, value] of unpack) gl.pixelStorei(name, value);
          gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer);
          gl.activeTexture(active!); gl.bindTexture(gl.TEXTURE_2D, binding);
        } catch { success = false; }
      }
    }
    if (gl.isContextLost()) {
      // The context owns no live allocations now; avoid deleting invalid names.
      this.contextLost(); return;
    }
    if (!success || !texture) {
      if (allocated) this.gpuBytes -= bytes;
      if (texture) gl.deleteTexture(texture);
      this.fail(request); return;
    }
    this.residents.set(request.key, { id: request.id, texture, ready: true, tier: request.tier, bytes, lastUsed: this.now });
    this.failures.delete(request.key); this.uploads++;
    this.release(request);
    for (const resident of [...this.residents.values()]) {
      if (resident.id === request.id && resident.tier > 2 && resident.tier < request.tier) this.remove(resident);
    }
  }
}
