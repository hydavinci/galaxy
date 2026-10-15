import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { PlanetTextureManager, type PlanetTextureOptions, type PlanetTextureDemand } from '../src/observer/planet-textures';
import type { CameraState } from '../src/observer/types';

// Deterministic CPU/Image/WebGL lifecycle tests, NOT browser decoding, GPU pixel,
// network availability, visual quality, or frame-time measurements. No timers,
// network, DOM globals, or private manager fields are used by the harness.
const MiB = 1024 * 1024;
const CAMERA: CameraState = { azimuthDeg: 10, altitudeDeg: 20, fovDeg: 1 };
const demand = (id = 'moon', devicePixelDiameter = 2400): PlanetTextureDemand[] => [{ id, devicePixelDiameter }];
function mipBytes(width: number, height: number): number {
  let result = 0;
  do {
    result += width * height * 4;
    if (width === 1 && height === 1) return result;
    width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
  } while (true);
}
const B2 = mipBytes(2048, 1024), B4 = mipBytes(4096, 2048), B8 = mipBytes(8192, 4096);

// Actual shipped contract, independently enumerated (not imported from manager).
// SSS's nominal 8k sun/Jupiter/Saturn originals are actually 4096 pixels wide.
const ASSETS = [
  { id: 'sun', stem: 'sun', tiers: [2, 4] },
  { id: 'moon', stem: 'moon', tiers: [2, 4, 8] },
  { id: 'mercury', stem: 'mercury', tiers: [2, 4, 8] },
  { id: 'venus', stem: 'venus_atmosphere', tiers: [2, 4] },
  { id: 'mars', stem: 'mars', tiers: [2, 4, 8] },
  { id: 'jupiter', stem: 'jupiter', tiers: [2, 4] },
  { id: 'saturn', stem: 'saturn', tiers: [2, 4] },
  { id: 'uranus', stem: 'uranus', tiers: [2] },
  { id: 'neptune', stem: 'neptune', tiers: [2] },
  { id: 'saturn-ring', stem: 'saturn_ring_alpha', tiers: [2, 8] },
] as const;
function assetPath(id: string, tier: number): string {
  const asset = ASSETS.find(a => a.id === id)!;
  const ring = id === 'saturn-ring';
  return `./textures/${tier > 2 || id === 'venus' || ring ? 'detail/' : ''}${tier}k_${asset.stem}.${ring ? 'png' : 'jpg'}`;
}
function dimensions(id: string, tier: number): [number, number] {
  return [tier * 1024, id === 'saturn-ring' ? tier * 62.5 : tier * 512];
}
function fileDimensions(bytes: Buffer): [number, number] {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'JPEG SOI');
  for (let p = 2; p < bytes.length;) {
    assert.equal(bytes[p++], 0xff, 'JPEG marker prefix');
    while (bytes[p] === 0xff) p++;
    const marker = bytes[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes.readUInt16BE(p);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return [bytes.readUInt16BE(p + 5), bytes.readUInt16BE(p + 3)];
    }
    assert.ok(length >= 2); p += length;
  }
  throw new Error('No JPEG SOF');
}

class ControlledImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = '';
  naturalWidth = 0;
  naturalHeight = 0;
  decodeCalls = 0;
  readonly assignments: string[] = [];
  requestedUrl = '';
  throwOnSource = false;
  private source = '';
  private resolveDecode!: () => void;
  private rejectDecode!: (reason: Error) => void;
  private readonly decoded = new Promise<void>((resolve, reject) => {
    this.resolveDecode = resolve; this.rejectDecode = reject;
  });
  get src(): string { return this.source; }
  set src(value: string) {
    this.assignments.push(value); this.source = value;
    if (value) { this.requestedUrl = value; if (this.throwOnSource) throw new Error('src failed'); }
  }
  decode(): Promise<void> { this.decodeCalls++; return this.decoded; }
  load(width?: number, height?: number): void {
    const match = /\/(\d)k_/.exec(this.requestedUrl);
    assert.ok(match, this.requestedUrl);
    const tier = Number(match[1]);
    this.naturalWidth = width ?? tier * 1024;
    this.naturalHeight = height ?? tier * (this.requestedUrl.includes('ring_alpha') ? 62.5 : 512);
    this.onload?.();
  }
  resolve(): void { this.resolveDecode(); }
  reject(): void { this.rejectDecode(new Error('decode failed')); }
  error(): void { this.onerror?.(); }
}

type Texture = WebGLTexture & { serial: number };
type Fault = 'create-null' | 'upload-error' | 'upload-throw' | 'mip-error' | 'mip-throw' | 'filter-error' | 'context-loss';
class MockGL {
  readonly MAX_TEXTURE_SIZE = 0x0d33; readonly ACTIVE_TEXTURE = 0x84e0;
  readonly TEXTURE0 = 0x84c0; readonly TEXTURE_2D = 0x0de1; readonly TEXTURE_BINDING_2D = 0x8069;
  readonly PIXEL_UNPACK_BUFFER = 0x88ec; readonly PIXEL_UNPACK_BUFFER_BINDING = 0x88ef;
  readonly UNPACK_ALIGNMENT = 0x0cf5; readonly UNPACK_FLIP_Y_WEBGL = 0x9240;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241; readonly UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;
  readonly UNPACK_ROW_LENGTH = 0x0cf2; readonly UNPACK_IMAGE_HEIGHT = 0x806e;
  readonly UNPACK_SKIP_PIXELS = 0x0cf4; readonly UNPACK_SKIP_ROWS = 0x0cf3; readonly UNPACK_SKIP_IMAGES = 0x806d;
  readonly RGBA = 0x1908; readonly UNSIGNED_BYTE = 0x1401;
  readonly TEXTURE_MIN_FILTER = 0x2801; readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_WRAP_S = 0x2802; readonly TEXTURE_WRAP_T = 0x2803;
  readonly LINEAR_MIPMAP_LINEAR = 0x2703; readonly LINEAR = 0x2601;
  readonly REPEAT = 0x2901; readonly CLAMP_TO_EDGE = 0x812f;
  readonly NO_ERROR = 0; readonly INVALID_OPERATION = 0x0502; readonly OUT_OF_MEMORY = 0x0505;
  readonly CONTEXT_LOST_WEBGL = 0x9242;
  phase: 'idle' | 'construct' | 'update' | 'dispose' = 'idle';
  lost = false;
  fault: Fault | undefined;
  stickyError: number | undefined;
  readonly errors: number[] = [];
  readonly calls: { name: string; args: unknown[] }[] = [];
  readonly violations: string[] = [];
  readonly live = new Map<Texture, { bytes: number; width: number; height: number; mipped: boolean; params: Map<number, number> }>();
  readonly deleted: Texture[] = [];
  readonly uploads: { texture: Texture; image: ControlledImage }[] = [];
  actualPeakBytes = 0;
  onUpload?: () => void;
  onMip?: () => void;
  private serial = 0;
  private active = this.TEXTURE0 + 3;
  private readonly bindings = new Map<number, Texture | null>([
    [this.TEXTURE0, { serial: -1 } as Texture],
    [this.TEXTURE0 + 3, { serial: -2 } as Texture],
    [this.TEXTURE0 + 7, { serial: -3 } as Texture],
  ]);
  private pbo: WebGLBuffer | null = { external: 'PBO' } as WebGLBuffer;
  readonly unpack = new Map<number, number | boolean>([
    [this.UNPACK_ALIGNMENT, 8], [this.UNPACK_FLIP_Y_WEBGL, true],
    [this.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true], [this.UNPACK_COLORSPACE_CONVERSION_WEBGL, 0x9244],
    [this.UNPACK_ROW_LENGTH, 63], [this.UNPACK_IMAGE_HEIGHT, 79],
    [this.UNPACK_SKIP_PIXELS, 3], [this.UNPACK_SKIP_ROWS, 5], [this.UNPACK_SKIP_IMAGES, 7],
  ]);
  constructor(readonly maxSize = 8192) {}
  private call(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
    if (this.phase === 'idle') { this.violations.push(name); throw new Error(`GL ${name} outside update/dispose/constructor`); }
  }
  snapshot() { return { active: this.active, bindings: [...this.bindings], pbo: this.pbo, unpack: [...this.unpack] }; }
  count(name: string): number { return this.calls.filter(c => c.name === name).length; }
  bytes(): number { return [...this.live.values()].reduce((sum, value) => sum + value.bytes, 0); }
  lose(): void { this.lost = true; this.live.clear(); }
  isContextLost(): boolean { this.call('isContextLost'); return this.lost; }
  getParameter(name: number): unknown {
    this.call('getParameter', name);
    if (name === this.MAX_TEXTURE_SIZE) return this.maxSize;
    if (name === this.ACTIVE_TEXTURE) return this.active;
    if (name === this.TEXTURE_BINDING_2D) return this.bindings.get(this.active) ?? null;
    if (name === this.PIXEL_UNPACK_BUFFER_BINDING) return this.pbo;
    assert.ok(this.unpack.has(name), `unknown parameter ${name}`); return this.unpack.get(name);
  }
  getError(): number { this.call('getError'); return this.lost ? this.CONTEXT_LOST_WEBGL : this.stickyError ?? this.errors.shift() ?? this.NO_ERROR; }
  activeTexture(unit: number): void { this.call('activeTexture', unit); this.active = unit; }
  bindTexture(target: number, texture: Texture | null): void {
    this.call('bindTexture', target, texture); assert.equal(target, this.TEXTURE_2D); this.bindings.set(this.active, texture);
  }
  bindBuffer(target: number, buffer: WebGLBuffer | null): void {
    this.call('bindBuffer', target, buffer); assert.equal(target, this.PIXEL_UNPACK_BUFFER); this.pbo = buffer;
  }
  pixelStorei(name: number, value: number | boolean): void {
    this.call('pixelStorei', name, value); assert.ok(this.unpack.has(name)); this.unpack.set(name, value);
  }
  createTexture(): Texture | null {
    this.call('createTexture');
    if (this.fault === 'create-null') { this.fault = undefined; return null; }
    const texture = { serial: ++this.serial } as Texture;
    this.live.set(texture, { bytes: 0, width: 0, height: 0, mipped: false, params: new Map() }); return texture;
  }
  deleteTexture(texture: Texture): void {
    this.call('deleteTexture', texture);
    assert.equal(this.lost, false, 'must not delete lost GL names');
    assert.ok(this.live.has(texture), 'no double delete / deletion of caller-owned texture');
    this.live.delete(texture); this.deleted.push(texture);
    for (const [unit, value] of this.bindings) if (value === texture) this.bindings.set(unit, null);
  }
  texImage2D(target: number, level: number, internal: number, format: number, type: number, image: ControlledImage): void {
    this.call('texImage2D', target, level, internal, format, type, image);
    assert.deepEqual([target, level, internal, format, type], [this.TEXTURE_2D, 0, this.RGBA, this.RGBA, this.UNSIGNED_BYTE]);
    assert.equal(this.pbo, null, 'DOM uploads must unbind caller PBO');
    for (const [name, value] of this.unpack) assert.equal(Number(value), name === this.UNPACK_ALIGNMENT ? 1 : 0, `unpack ${name}`);
    assert.equal(image.decodeCalls, 1, 'decode before upload');
    const texture = this.bindings.get(this.active)!;
    assert.ok(texture && this.live.has(texture)); this.uploads.push({ texture, image }); this.onUpload?.();
    if (this.fault === 'context-loss') { this.fault = undefined; this.lose(); return; }
    if (this.fault === 'upload-throw') { this.fault = undefined; throw new Error('upload threw'); }
    if (this.fault === 'upload-error') { this.fault = undefined; this.errors.push(this.OUT_OF_MEMORY); return; }
    Object.assign(this.live.get(texture)!, { width: image.naturalWidth, height: image.naturalHeight, bytes: image.naturalWidth * image.naturalHeight * 4 });
    this.actualPeakBytes = Math.max(this.actualPeakBytes, this.bytes());
  }
  generateMipmap(target: number): void {
    this.call('generateMipmap', target); assert.equal(target, this.TEXTURE_2D); this.onMip?.();
    if (this.fault === 'mip-throw') { this.fault = undefined; throw new Error('mipmap threw'); }
    if (this.fault === 'mip-error') { this.fault = undefined; this.errors.push(this.OUT_OF_MEMORY); return; }
    const resident = this.live.get(this.bindings.get(this.active)!)!;
    resident.bytes = mipBytes(resident.width, resident.height); resident.mipped = true;
    this.actualPeakBytes = Math.max(this.actualPeakBytes, this.bytes());
  }
  texParameteri(target: number, name: number, value: number): void {
    this.call('texParameteri', target, name, value); assert.equal(target, this.TEXTURE_2D);
    this.live.get(this.bindings.get(this.active)!)!.params.set(name, value);
    if (this.fault === 'filter-error') { this.fault = undefined; this.errors.push(this.INVALID_OPERATION); }
  }
}

async function flush(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }
class Harness {
  readonly gl: MockGL;
  readonly manager: PlanetTextureManager;
  readonly images: ControlledImage[] = [];
  now = 0;
  currentDemands: PlanetTextureDemand[] = [];
  camera = { ...CAMERA };
  constructor(t: TestContext, options: PlanetTextureOptions = {}, maxSize = 8192) {
    this.gl = new MockGL(maxSize); this.gl.phase = 'construct';
    this.manager = new PlanetTextureManager(this.gl as unknown as WebGL2RenderingContext, {
      deviceMemoryGiB: 16, mobile: false, stableMs: 100, retryDelayMs: 100, loadTimeoutMs: 10000,
      imageFactory: () => { const image = new ControlledImage(); this.images.push(image); return image as unknown as HTMLImageElement; },
      ...options,
    });
    this.gl.phase = 'idle';
    t.after(() => { this.dispose(); assert.deepEqual(this.gl.violations, [], 'no GL calls in Image callbacks or get/stats'); });
  }
  step(now: number, demands = this.currentDemands, camera = this.camera): void {
    const before = this.gl.snapshot(), uploads = this.gl.count('texImage2D'), mips = this.gl.count('generateMipmap');
    this.now = now; this.currentDemands = demands; this.camera = { ...camera }; this.gl.phase = 'update';
    try { this.manager.update(camera, demands, now); } finally { this.gl.phase = 'idle'; }
    assert.ok(this.gl.count('texImage2D') - uploads <= 1, 'at most ONE upload attempt per update, including failures');
    assert.ok(this.gl.count('generateMipmap') - mips <= 1, 'at most ONE mip chain per update, including failures');
    assert.deepEqual(this.gl.snapshot(), before, 'exact active unit / all unit bindings / PBO / nine unpack inputs restored');
    const s = this.manager.getStats();
    assert.ok(s.baseLoading <= s.maxConcurrentBaseLoads && s.hdLoading <= 1, 'bounded active requests');
    assert.ok(s.gpuBytes + s.reservedBytes <= s.budgetBytes, 'resident plus reserved memory bounded');
    assert.ok(s.peakGpuBytes <= s.budgetBytes && this.gl.actualPeakBytes <= s.budgetBytes, 'transient allocation bounded');
    assert.equal(s.gpuBytes, this.gl.bytes(), 'independent mip allocation accounting');
  }
  image(id: string, tier: number, occurrence = -1): ControlledImage {
    const found = this.images.filter(i => i.requestedUrl === assetPath(id, tier));
    const image = occurrence < 0 ? found[found.length + occurrence] : found[occurrence];
    assert.ok(image, `missing request ${assetPath(id, tier)}; got ${this.images.map(i => i.requestedUrl).join(', ')}`); return image;
  }
  async callback(action: () => void): Promise<void> {
    const count = this.gl.calls.length; action(); await flush();
    assert.equal(this.gl.calls.length, count, 'download/decode callback made a GL call');
  }
  async beginDecode(image: ControlledImage, width?: number, height?: number): Promise<void> {
    await this.callback(() => image.load(width, height)); assert.equal(image.decodeCalls, 1);
  }
  async finish(image: ControlledImage, width?: number, height?: number): Promise<void> {
    await this.beginDecode(image, width, height); await this.callback(() => image.resolve());
  }
  dispose(): void {
    this.gl.phase = 'dispose'; try { this.manager.dispose(); } finally { this.gl.phase = 'idle'; }
  }
}
async function base(h: Harness, id = 'moon', diameter = 2400): Promise<Texture> {
  h.step(0, demand(id, diameter)); await h.finish(h.image(id, 2)); h.step(1);
  assert.equal(h.manager.get(id)?.tier, 2); return h.manager.get(id)!.texture as Texture;
}
async function four(h: Harness, id = 'moon'): Promise<Texture> {
  await base(h, id, 1100); h.step(100); await h.finish(h.image(id, 4)); h.step(101);
  assert.equal(h.manager.get(id)?.tier, 4); return h.manager.get(id)!.texture as Texture;
}

// Real local header checks prevent accidental fictional 8k fixtures or square ring maps.
test('shipped asset paths and actual headers match the independently declared 2k/4k/8k contract', () => {
  for (const asset of ASSETS) for (const tier of asset.tiers) {
    const file = new URL(`../public/${assetPath(asset.id, tier).slice(2)}`, import.meta.url);
    assert.deepEqual(fileDimensions(readFileSync(file)), dimensions(asset.id, tier), file.pathname);
  }
});

test('constructor/get/stats do not fetch, decode or allocate; reads do not start work', t => {
  const h = new Harness(t);
  assert.equal(h.images.length, 0); assert.equal(h.gl.count('createTexture'), 0);
  for (const a of ASSETS) assert.equal(h.manager.get(a.id), undefined);
  assert.equal(h.manager.get('earth'), undefined);
  assert.equal(h.manager.getStats().requested, 0);
  assert.deepEqual(h.gl.calls.map(c => c.name), ['getParameter']);
});

test('first frame has zero HD, at most two bases, largest-demand priority and duplicate/invalid filtering', t => {
  const h = new Harness(t);
  h.step(0, [
    ...demand('moon', 2400), ...demand('mars', 2300), ...demand('sun', 2000),
    ...demand('moon', 1), ...demand('unsupported-body', 99999), ...demand('venus', NaN),
    ...demand('uranus', -5), ...demand('neptune', Infinity), ...demand('saturn', 0),
  ]);
  assert.deepEqual(h.images.map(i => i.requestedUrl), [assetPath('moon', 2), assetPath('mars', 2)]);
  assert.equal(h.manager.getStats().hdLoading, 0); assert.equal(h.manager.getStats().stable, false);
  h.step(1000);
  assert.equal(h.images.length, 2, 'HD cannot compete with its own unfinished base');
  assert.equal(h.manager.getStats().hdLoading, 0);
});

test('two decoded bases upload on separate frames, never in callbacks or equal/backward timestamps', async t => {
  const h = new Harness(t);
  h.step(0, [...demand('moon', 100), ...demand('mars', 90)]);
  await h.finish(h.image('moon', 2)); await h.finish(h.image('mars', 2));
  assert.equal(h.manager.getStats().decoded, 2); assert.equal(h.gl.count('texImage2D'), 0);
  h.step(1); assert.equal(h.manager.getStats().uploads, 1); assert.equal(h.manager.getStats().decoded, 1);
  h.step(1); h.step(-100); h.step(NaN); assert.equal(h.manager.getStats().uploads, 1);
  h.step(2); assert.equal(h.manager.getStats().uploads, 2); assert.equal(h.manager.getStats().gpuBytes, 2 * B2);
  for (const texture of h.gl.live.values()) {
    assert.equal(texture.mipped, true);
    assert.deepEqual([...texture.params], [
      [h.gl.TEXTURE_MIN_FILTER, h.gl.LINEAR_MIPMAP_LINEAR], [h.gl.TEXTURE_MAG_FILTER, h.gl.LINEAR],
      [h.gl.TEXTURE_WRAP_S, h.gl.REPEAT], [h.gl.TEXTURE_WRAP_T, h.gl.CLAMP_TO_EDGE],
    ]);
  }
});

test('default stability delay is 350ms, with a base-only first frame', async t => {
  const h = new Harness(t, { stableMs: undefined }); await base(h);
  h.step(349); assert.equal(h.manager.getStats().hdLoading, 0);
  h.step(350); assert.equal(h.manager.getStats().hdLoading, 1);
  assert.equal(h.image('moon', 8).decoding, 'async');
});

for (const asset of ASSETS) test(`actual tier routing: ${asset.id} uses only shipped tiers and detail/ paths`, async t => {
  const h = new Harness(t); await base(h, asset.id, 10000);
  h.step(100);
  const highest = asset.tiers[asset.tiers.length - 1];
  assert.deepEqual(h.images.map(i => i.requestedUrl), highest === 2 ? [assetPath(asset.id, 2)] : [assetPath(asset.id, 2), assetPath(asset.id, highest)]);
  if (highest > 2) { await h.finish(h.image(asset.id, highest)); h.step(101); }
  assert.equal(h.manager.get(asset.id)?.tier, highest);
  if (asset.id === 'saturn-ring') {
    const state = h.gl.live.get(h.manager.get(asset.id)!.texture as Texture)!;
    assert.deepEqual([state.width, state.height], [8192, 500]);
    assert.equal(state.params.get(h.gl.TEXTURE_WRAP_S), h.gl.CLAMP_TO_EDGE, 'x is radial profile, not repeated longitude');
    assert.equal(state.params.get(h.gl.TEXTURE_WRAP_T), h.gl.CLAMP_TO_EDGE);
    assert.equal(h.manager.getStats().gpuBytes, mipBytes(2048, 125) + mipBytes(8192, 500));
  }
});

for (const [diameter, tier] of [[899, 2], [900, 4], [1799, 4], [1800, 8]] as const) {
  test(`device-pixel demand threshold ${diameter} selects ${tier}k after stability`, async t => {
    const h = new Harness(t); await base(h, 'moon', diameter); h.step(100);
    assert.equal(h.images.length, tier === 2 ? 1 : 2);
    if (tier > 2) assert.equal(h.images[1].requestedUrl, assetPath('moon', tier));
  });
}

test('HD loading cancels on zoom-out and old ready base remains usable; fresh zoom-in waits again', async t => {
  const h = new Harness(t); const old = await base(h); h.step(100); const pending = h.image('moon', 8);
  h.step(110, demand('moon', 100), { ...CAMERA, fovDeg: 20 });
  assert.equal(pending.src, ''); assert.equal(pending.onload, null); assert.equal(pending.onerror, null);
  assert.equal(h.manager.get('moon')?.texture, old); assert.equal(h.manager.getStats().hdLoading, 0);
  h.step(120, demand('moon', 2400), CAMERA); h.step(219); assert.equal(h.images.length, 2);
  h.step(220); assert.equal(h.images.length, 3); assert.notEqual(h.image('moon', 8), pending);
});

test('decoded stale upgrade is cancelled before upload when demand shrinks', async t => {
  const h = new Harness(t); const old = await base(h); h.step(100); await h.finish(h.image('moon', 8));
  const count = h.gl.count('texImage2D'); h.step(101, demand('moon', 100));
  assert.equal(h.gl.count('texImage2D'), count); assert.equal(h.manager.get('moon')?.texture, old);
  assert.equal(h.manager.getStats().decoded, 0); assert.equal(h.manager.getStats().draining, 0);
});

test('focus change invalidates a decoded HD upgrade even while the old body remains visible', async t => {
  const h = new Harness(t); const old = await base(h); h.step(100); await h.finish(h.image('moon', 8));
  h.step(101, [...demand('mars', 2500), ...demand('moon', 2400)]);
  assert.equal(h.manager.get('moon')?.texture, old); assert.equal(h.manager.getStats().uploads, 1);
  assert.equal(h.manager.getStats().stable, false); assert.equal(h.manager.getStats().hdLoading, 0);
});

test('many individually tiny zoom changes accumulate against the stability anchor', async t => {
  const h = new Harness(t); await base(h); h.step(100); const pending = h.image('moon', 8);
  for (let i = 1; i <= 6; i++) h.step(100 + i * 10, undefined, { ...CAMERA, fovDeg: Math.exp(i * 0.001) });
  assert.equal(pending.src, ''); assert.equal(h.manager.getStats().stable, false);
  h.step(259); assert.equal(h.images.length, 2); h.step(260); assert.equal(h.images.length, 3);
});

test('fast narrow-field pan cancels detail, but coherent low-rate sampled tracking can stabilize', async t => {
  const h = new Harness(t); const c = { ...CAMERA, altitudeDeg: 0, fovDeg: 0.0001 };
  h.step(0, demand(), c); await h.finish(h.image('moon', 2)); h.step(1); h.step(100);
  const old = h.image('moon', 8); h.step(110, undefined, { ...c, azimuthDeg: c.azimuthDeg + 0.05 });
  assert.equal(old.src, ''); assert.equal(h.manager.getStats().stable, false);
  const tracking = new Harness(t); tracking.step(0, demand(), c);
  await tracking.finish(tracking.image('moon', 2)); tracking.step(1);
  tracking.step(250, undefined, { ...c, azimuthDeg: c.azimuthDeg + 0.001 });
  assert.equal(tracking.manager.getStats().hdLoading, 0);
  tracking.step(500, undefined, { ...c, azimuthDeg: c.azimuthDeg + 0.002 });
  assert.equal(tracking.manager.getStats().stable, true); assert.equal(tracking.manager.getStats().hdLoading, 1);
});

test('invalid camera never becomes stable or schedules HD', async t => {
  const h = new Harness(t); await base(h);
  for (const [index, bad] of [
    { ...CAMERA, azimuthDeg: NaN }, { ...CAMERA, altitudeDeg: Infinity },
    { ...CAMERA, fovDeg: 0 }, { ...CAMERA, fovDeg: 180 },
  ].entries()) { h.step((index + 1) * 1000, undefined, bad); assert.equal(h.manager.getStats().hdLoading, 0); }
  assert.equal(h.images.length, 1);
});

test('cancelled decode holds its HD slot until settlement, even beyond timeout; late result never uploads', async t => {
  const h = new Harness(t, { loadTimeoutMs: 1000 }); const old = await base(h); h.step(100);
  const pending = h.image('moon', 8); await h.beginDecode(pending);
  h.step(101, []); assert.equal(h.manager.getStats().draining, 1); assert.equal(h.manager.getStats().hdLoading, 0);
  h.step(102, demand()); h.step(5000); assert.equal(h.images.length, 2, 'do not accumulate uncancellable 8k decoders');
  assert.equal(h.manager.get('moon')?.texture, old); assert.equal(h.manager.getStats().decoding, 1);
  await h.callback(() => pending.resolve()); assert.equal(h.manager.getStats().draining, 0);
  h.step(5001); assert.equal(h.images.length, 3); assert.equal(h.manager.getStats().uploads, 1);
});

test('cancelled base decode holds its bounded base slot until settlement', async t => {
  const h = new Harness(t, { maxConcurrentBaseLoads: 1 }); h.step(0, demand('moon', 100));
  const pending = h.image('moon', 2); await h.beginDecode(pending);
  h.step(1, demand('mars', 100)); h.step(1000);
  assert.equal(h.images.length, 1); assert.equal(h.manager.getStats().draining, 1);
  await h.callback(() => pending.reject()); h.step(1001);
  assert.equal(h.images.length, 2); assert.equal(h.image('mars', 2).decodeCalls, 0);
});

test('4k remains published through 8k decode/upload/mips and is deleted only after successful replacement', async t => {
  const h = new Harness(t); const old4 = await four(h); const base2 = h.image('moon', 2);
  h.step(200, demand()); h.step(300); const image8 = h.image('moon', 8);
  await h.beginDecode(image8); assert.equal(h.manager.get('moon')?.texture, old4); assert.ok(h.gl.live.has(old4));
  await h.callback(() => image8.resolve());
  for (const stage of ['onUpload', 'onMip'] as const) h.gl[stage] = () => {
    assert.equal(h.manager.get('moon')?.texture, old4); assert.ok(h.gl.live.has(old4));
    assert.equal(h.manager.getStats().gpuBytes, B2 + B4 + B8, 'reserve new full chain while old good image lives');
  };
  h.step(301); assert.equal(h.manager.get('moon')?.tier, 8); assert.ok(h.gl.deleted.includes(old4));
  assert.equal(h.manager.getStats().gpuBytes, B2 + B8); assert.equal(h.manager.getStats().peakGpuBytes, B2 + B4 + B8);
  assert.equal(h.gl.actualPeakBytes, B2 + B4 + B8); assert.equal(h.manager.getStats().baseReady, 1);
  assert.equal(base2.src, '', 'successful image source released');
});

test('zoom-out retains a good HD resident until detail-idle expiry, then falls back to the pinned base', async t => {
  const h = new Harness(t, { detailIdleMs: 100 }); const old = await four(h);
  h.step(150, demand('moon', 100)); assert.equal(h.manager.get('moon')?.texture, old);
  h.step(200); assert.equal(h.manager.get('moon')?.tier, 4);
  h.step(201); assert.equal(h.manager.get('moon')?.tier, 2); assert.ok(h.gl.deleted.includes(old));
});

for (const kind of ['download', 'decode'] as const) test(`${kind} failure uses exponential backoff and at most 2 retries`, async t => {
  const h = new Harness(t); h.step(0, demand('moon', 100));
  const fail = async (image: ControlledImage) => {
    if (kind === 'decode') { await h.beginDecode(image); await h.callback(() => image.reject()); }
    else await h.callback(() => image.error());
  };
  await fail(h.image('moon', 2)); assert.equal(h.manager.getStats().failuresTotal, 0, 'callback only queues failure');
  h.step(1); assert.equal(h.manager.getStats().failuresTotal, 1); h.step(100); assert.equal(h.images.length, 1);
  h.step(101); await fail(h.image('moon', 2)); h.step(102); h.step(301); assert.equal(h.images.length, 2);
  h.step(302); await fail(h.image('moon', 2)); h.step(303); h.step(50000);
  assert.equal(h.images.length, 3); assert.equal(h.manager.getStats().failed, 1);
  assert.equal(h.manager.getStats().failuresTotal, 3); assert.equal(h.gl.count('texImage2D'), 0);
});

for (const kind of ['download', 'decode'] as const) test(`failed 8k ${kind} never clears a previously ready 4k image`, async t => {
  const h = new Harness(t); const old = await four(h); h.step(200, demand()); h.step(300); const next = h.image('moon', 8);
  if (kind === 'decode') { await h.beginDecode(next); await h.callback(() => next.reject()); }
  else await h.callback(() => next.error());
  h.step(301); assert.equal(h.manager.get('moon')?.texture, old); assert.ok(h.gl.live.has(old));
  assert.equal(h.manager.getStats().gpuBytes, B2 + B4); assert.equal(h.manager.getStats().failuresTotal, 1);
});

for (const fault of ['create-null', 'upload-error', 'upload-throw', 'mip-error', 'mip-throw', 'filter-error'] as const) {
  test(`GL ${fault}: restore exact caller state, delete only failed replacement, preserve old 4k`, async t => {
    const h = new Harness(t); const old = await four(h); h.step(200, demand()); h.step(300);
    await h.finish(h.image('moon', 8)); const deletedBefore = h.gl.deleted.length; h.gl.fault = fault;
    h.step(301); assert.equal(h.manager.get('moon')?.texture, old); assert.ok(h.gl.live.has(old));
    assert.equal(h.manager.getStats().gpuBytes, B2 + B4); assert.equal(h.manager.getStats().uploads, 2);
    assert.equal(h.manager.getStats().failuresTotal, 1);
    assert.equal(h.gl.deleted.length - deletedBefore, fault === 'create-null' ? 0 : 1);
    assert.equal(h.gl.live.size, 2);
  });
}

test('base exhaustion allows an independently usable detail tier; failed preferred 8k falls back to 4k', async t => {
  const h = new Harness(t, { maxRetries: 0 }); h.step(0, demand());
  await h.callback(() => h.image('moon', 2).error()); h.step(1); h.step(100);
  await h.callback(() => h.image('moon', 8).error()); h.step(101);
  assert.equal(h.images.at(-1)?.requestedUrl, assetPath('moon', 4));
  await h.finish(h.image('moon', 4)); h.step(102);
  assert.equal(h.manager.get('moon')?.tier, 4); assert.equal(h.manager.getStats().gpuBytes, B4);
});

test('dimension mismatch is permanent and rejected before decode; post-decode dimension changes are rechecked', async t => {
  const h = new Harness(t); h.step(0, demand('moon', 100)); const bad = h.image('moon', 2);
  await h.callback(() => bad.load(4096, 2048)); assert.equal(bad.decodeCalls, 0);
  h.step(1); h.step(10000); assert.equal(h.images.length, 1); assert.equal(h.manager.getStats().failed, 1);
  const changing = new Harness(t); changing.step(0, demand('moon', 100)); const image = changing.image('moon', 2);
  await changing.beginDecode(image); image.naturalHeight = 1023; await changing.callback(() => image.resolve());
  changing.step(1); assert.equal(changing.manager.getStats().failed, 1); assert.equal(changing.gl.count('texImage2D'), 0);
});

test('ring accepts actual 2048x125 / 8192x500 and padded strips, never a square or sphere', async t => {
  for (const [height, valid] of [[125, true], [128, true], [1024, false], [2048, false], [126, false]] as const) {
    const h = new Harness(t); h.step(0, demand('saturn-ring', 100)); const image = h.image('saturn-ring', 2);
    await h.callback(() => image.load(2048, height));
    if (valid) { assert.equal(image.decodeCalls, 1); await h.callback(() => image.resolve()); }
    else assert.equal(image.decodeCalls, 0);
    h.step(1); assert.equal(h.manager.getStats().uploads, Number(valid));
    assert.equal(h.manager.getStats().gpuBytes, valid ? mipBytes(2048, height) : 0);
  }
  const h = new Harness(t); await base(h, 'saturn-ring'); h.step(100);
  await h.finish(h.image('saturn-ring', 8), 8192, 512); h.step(101);
  assert.equal(h.manager.get('saturn-ring')?.tier, 8);
});

for (const [size, tier] of [[0, 2], [1024, 2], [2048, 2], [4096, 4], [8192, 8]] as const) {
  test(`MAX_TEXTURE_SIZE=${size} never requests a larger image`, async t => {
    const h = new Harness(t, {}, size); h.step(0, demand());
    assert.equal(h.manager.getStats().maxTextureSize, size); assert.equal(h.manager.getStats().maxTier, tier);
    if (size < 2048) { h.step(1000); assert.equal(h.images.length, 0); return; }
    await h.finish(h.image('moon', 2)); h.step(1); h.step(100);
    assert.equal(h.images.length, tier === 2 ? 1 : 2);
    if (tier > 2) assert.equal(h.images.at(-1)?.requestedUrl, assetPath('moon', tier));
  });
}

for (const options of [
  { deviceMemoryGiB: 4, mobile: false }, { deviceMemoryGiB: 16, mobile: true },
  { deviceMemoryGiB: NaN, mobile: false }, { deviceMemoryGiB: Infinity, mobile: false },
] as const) test(`conservative capabilities: memory=${options.deviceMemoryGiB}, mobile=${options.mobile}`, async t => {
  const h = new Harness(t, { ...options, gpuBudgetBytes: 1024 * MiB }); await base(h); h.step(100);
  assert.equal(h.manager.getStats().maxTier, 4); assert.equal(h.manager.getStats().budgetBytes, 64 * MiB);
  assert.equal(h.images.at(-1)?.requestedUrl, assetPath('moon', 4));
});

test('navigator capability inference treats unknown memory and touch/mobile devices conservatively', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    for (const nav of [
      {}, { deviceMemory: 16, maxTouchPoints: 1 }, { deviceMemory: 16, userAgent: 'Mozilla iPad Mobile' },
      { deviceMemory: 8, maxTouchPoints: 0, userAgent: 'Desktop' },
    ]) {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
      const h = new Harness(t, { deviceMemoryGiB: undefined, mobile: undefined });
      const full = 'maxTouchPoints' in nav && nav.maxTouchPoints === 0;
      assert.equal(h.manager.getStats().maxTier, full ? 8 : 4);
      assert.equal(h.manager.getStats().budgetBytes, (full ? 256 : 64) * MiB);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('budgets and concurrency options only lower hard caps; zero budget fetches nothing', t => {
  const zero = new Harness(t, { gpuBudgetBytes: 0 }); zero.step(0, demand()); zero.step(1000); assert.equal(zero.images.length, 0);
  const one = new Harness(t, { maxConcurrentBaseLoads: 0 }); one.step(0, ASSETS.map(a => ({ id: a.id, devicePixelDiameter: 100 })));
  assert.equal(one.manager.getStats().baseLoading, 1);
  const huge = new Harness(t, { maxConcurrentBaseLoads: 999, gpuBudgetBytes: 1024 * MiB });
  assert.equal(huge.manager.getStats().maxConcurrentBaseLoads, 2); assert.equal(huge.manager.getStats().budgetBytes, 256 * MiB);
});

test('two base plus one detail slots are bounded; decoded bases precede HD and each frame uploads once', async t => {
  const h = new Harness(t); h.step(0, [...demand('moon', 2500), ...demand('mercury', 2400), ...demand('mars', 2300)]);
  await h.finish(h.image('moon', 2)); h.step(1); h.step(100);
  assert.equal(h.manager.getStats().baseLoading, 2); assert.equal(h.manager.getStats().hdLoading, 1);
  await h.finish(h.image('mercury', 2)); await h.finish(h.image('mars', 2)); await h.finish(h.image('moon', 8));
  h.step(101); assert.equal(h.gl.uploads.at(-1)?.image.requestedUrl, assetPath('mercury', 2));
  h.step(102); assert.equal(h.gl.uploads.at(-1)?.image.requestedUrl, assetPath('mars', 2));
  h.step(103); assert.equal(h.gl.uploads.at(-1)?.image.requestedUrl, assetPath('moon', 8));
  assert.equal(h.manager.getStats().uploads, 4);
});

test('reservations prevent concurrent overcommit before any GPU allocation', t => {
  const h = new Harness(t, { gpuBudgetBytes: B2 }); h.step(0, [...demand('moon', 100), ...demand('mars', 90)]);
  assert.equal(h.images.length, 1); assert.equal(h.manager.getStats().reservedBytes, B2); assert.equal(h.manager.getStats().gpuBytes, 0);
  h.step(1, []); assert.equal(h.manager.getStats().reservedBytes, 0);
});

test('full transient old+new cost is required, not only final 2k+8k residency; no speculative evictions', async t => {
  const h = new Harness(t, { gpuBudgetBytes: B2 + B8 }); const old = await four(h);
  h.step(200, demand()); h.step(300); h.step(1000);
  assert.equal(h.images.length, 2, '8k blocked because retained 4k makes transient cost exceed budget');
  assert.equal(h.manager.get('moon')?.texture, old); assert.equal(h.gl.deleted.length, 0);
  const direct = new Harness(t, { gpuBudgetBytes: B2 + B8 }); await base(direct); direct.step(100);
  await direct.finish(direct.image('moon', 8)); direct.step(101);
  assert.equal(direct.manager.getStats().peakGpuBytes, B2 + B8);
});

test('budget uses lower usable tier when 8k cannot fit alongside its base', async t => {
  const h = new Harness(t, { gpuBudgetBytes: B2 + B4 }); await base(h); h.step(100);
  assert.equal(h.images.at(-1)?.requestedUrl, assetPath('moon', 4));
  await h.finish(h.image('moon', 4)); h.step(101); assert.equal(h.manager.getStats().gpuBytes, B2 + B4);
});

test('LRU evicts an inactive least-recently-demanded base; get() alone never refreshes recency', async t => {
  const h = new Harness(t, { gpuBudgetBytes: 2 * B2 }); const moon = await base(h, 'moon', 100);
  h.step(10, demand('mars', 100)); await h.finish(h.image('mars', 2)); h.step(11); const mars = h.manager.get('mars')!.texture as Texture;
  h.step(20, demand('moon', 100)); assert.equal(h.manager.get('mars')?.texture, mars);
  h.step(30, demand('mercury', 100));
  assert.ok(h.gl.deleted.includes(mars)); assert.ok(h.gl.live.has(moon)); assert.equal(h.manager.get('mars'), undefined);
  await h.finish(h.image('mercury', 2)); h.step(31); assert.equal(h.manager.getStats().gpuBytes, 2 * B2);
});

test('inactive detail is evicted before inactive bases, while demanded usable residents stay protected', async t => {
  const h = new Harness(t, { gpuBudgetBytes: B4 + 2 * B2 }); const moon4 = await four(h);
  h.step(200, demand('mars', 100)); await h.finish(h.image('mars', 2)); h.step(201);
  const mars = h.manager.get('mars')!.texture as Texture;
  h.step(210, demand('mercury', 100)); assert.ok(h.gl.deleted.includes(moon4));
  assert.ok(h.gl.live.has(mars)); assert.equal(h.manager.get('moon')?.tier, 2);
  const protectedH = new Harness(t, { gpuBudgetBytes: 2 * B2 });
  protectedH.step(0, [...demand('moon', 100), ...demand('mars', 90)]);
  await protectedH.finish(protectedH.image('moon', 2)); await protectedH.finish(protectedH.image('mars', 2)); protectedH.step(1); protectedH.step(2);
  protectedH.step(3, [...demand('moon', 100), ...demand('mars', 90), ...demand('mercury', 80)]);
  assert.equal(protectedH.images.length, 2); assert.equal(protectedH.gl.deleted.length, 0);
});

test('idle expiry uses separate base/detail clocks and only runs in update', async t => {
  const h = new Harness(t, { detailIdleMs: 50, baseIdleMs: 100 }); await four(h); h.step(102, []);
  h.step(150); assert.equal(h.manager.get('moon')?.tier, 4);
  h.step(151); assert.equal(h.manager.get('moon')?.tier, 2); assert.equal(h.manager.getStats().evictions, 1);
  h.step(200); assert.equal(h.manager.get('moon')?.tier, 2);
  h.step(201); assert.equal(h.manager.get('moon'), undefined); assert.equal(h.manager.getStats().gpuBytes, 0);
});

test('download timeout clears handlers/source, ignores captured late callbacks, and retries only after backoff', async t => {
  const h = new Harness(t, { loadTimeoutMs: 100 }); h.step(0, demand('moon', 100));
  const image = h.image('moon', 2), onload = image.onload!, onerror = image.onerror!;
  h.step(99); assert.equal(h.manager.getStats().timeouts, 0); h.step(100);
  assert.equal(h.manager.getStats().timeouts, 1); assert.equal(image.src, ''); assert.equal(image.onload, null); assert.equal(image.onerror, null);
  await h.callback(() => { image.naturalWidth = 2048; image.naturalHeight = 1024; onload(); onerror(); });
  assert.equal(image.decodeCalls, 0); h.step(199); assert.equal(h.images.length, 1);
  h.step(200); assert.equal(h.images.length, 2); assert.equal(h.manager.getStats().uploads, 0);
});

test('decode timeout holds HD slot until rejection settles; failed/cancelled old result never revives', async t => {
  const h = new Harness(t, { loadTimeoutMs: 100 }); const old = await base(h); h.step(100);
  const image = h.image('moon', 8); await h.beginDecode(image); h.step(200);
  assert.equal(h.manager.getStats().timeouts, 1); assert.equal(h.manager.getStats().draining, 1);
  h.step(1000); assert.equal(h.images.length, 2); assert.equal(h.manager.get('moon')?.texture, old);
  await h.callback(() => image.reject()); h.step(1001);
  assert.equal(h.images.length, 3); assert.equal(h.manager.getStats().uploads, 1); assert.equal(h.manager.getStats().draining, 0);
});

test('dispose deletes residents exactly once, cancels loading/decoding, ignores every late completion and later update', async t => {
  const h = new Harness(t); await base(h); h.step(100); const image = h.image('moon', 8), late = image.onload!;
  await h.beginDecode(image); h.dispose();
  assert.equal(h.manager.getStats().disposed, true); assert.equal(h.manager.getStats().gpuBytes, 0);
  assert.equal(h.manager.getStats().loading, 0); assert.equal(h.manager.getStats().decoding, 0);
  assert.equal(h.manager.get('moon'), undefined); assert.equal(h.gl.deleted.length, 1);
  const count = h.gl.calls.length; h.dispose(); assert.equal(h.gl.calls.length, count);
  await h.callback(() => { image.resolve(); late(); }); h.step(10000);
  assert.equal(h.images.length, 2); assert.equal(h.gl.calls.length, count); assert.equal(h.gl.live.size, 0);
});

for (const route of ['explicit', 'detected', 'upload'] as const) test(`context loss (${route}) invalidates all state without deleting lost names; only a new manager recovers`, async t => {
  const h = new Harness(t); await base(h); h.step(100); const image = h.image('moon', 8);
  if (route === 'upload') {
    await h.finish(image); h.gl.fault = 'context-loss'; h.step(101);
  } else {
    await h.beginDecode(image); h.gl.lose();
    if (route === 'explicit') h.manager.contextLost(); else h.step(101);
    await h.callback(() => image.resolve());
  }
  assert.equal(h.manager.getStats().contextLost, true); assert.equal(h.manager.get('moon'), undefined);
  assert.equal(h.manager.getStats().gpuBytes, 0); assert.equal(h.manager.getStats().loading, 0);
  assert.equal(h.gl.deleted.length, 0); h.dispose(); assert.equal(h.gl.deleted.length, 0);
  const calls = h.gl.calls.length; h.gl.lost = false; h.step(200); assert.equal(h.gl.calls.length, calls);
  const fresh = new Harness(t); await base(fresh); assert.equal(fresh.manager.get('moon')?.tier, 2);
});

test('pre-existing sticky GL errors are drained before attribution; an endless error stream is bounded', async t => {
  const h = new Harness(t); h.step(0, demand('moon', 100)); await h.finish(h.image('moon', 2));
  h.gl.errors.push(h.gl.INVALID_OPERATION, h.gl.OUT_OF_MEMORY); h.step(1);
  assert.equal(h.manager.getStats().uploads, 1); assert.equal(h.manager.getStats().failuresTotal, 0);
  const broken = new Harness(t); broken.step(0, demand('moon', 100)); await broken.finish(broken.image('moon', 2));
  broken.gl.stickyError = broken.gl.INVALID_OPERATION; const count = broken.gl.count('getError'); broken.step(1);
  assert.equal(broken.gl.count('getError') - count, 16); assert.equal(broken.gl.count('createTexture'), 0);
  assert.equal(broken.manager.getStats().failuresTotal, 1);
});

test('image factory and src setter exceptions are bounded failures, not uncaught frame errors', t => {
  let attempts = 0;
  const h = new Harness(t, { maxRetries: 0, imageFactory: () => { attempts++; throw new Error('factory'); } });
  h.step(0, demand('moon', 100)); h.step(1000); assert.equal(attempts, 1); assert.equal(h.manager.getStats().failed, 1);
  const image = new ControlledImage(); image.throwOnSource = true;
  const source = new Harness(t, { maxRetries: 0, imageFactory: () => image as unknown as HTMLImageElement });
  source.step(0, demand('moon', 100)); source.step(1); source.step(1000);
  assert.equal(source.manager.getStats().failed, 1); assert.equal(source.manager.getStats().requested, 1); assert.equal(image.src, '');
});

test('failed first decoded upload still consumes the frame allowance; a second decoded image waits', async t => {
  for (const fault of ['upload-error', 'mip-error'] as const) {
    const h = new Harness(t); h.step(0, [...demand('moon', 100), ...demand('mars', 90)]);
    await h.finish(h.image('moon', 2)); await h.finish(h.image('mars', 2)); h.gl.fault = fault;
    h.step(1); assert.equal(h.gl.count('texImage2D'), 1); assert.equal(h.manager.getStats().uploads, 0);
    assert.equal(h.manager.getStats().decoded, 1); assert.equal(h.manager.get('mars'), undefined);
    h.step(2); assert.equal(h.gl.count('texImage2D'), 2); assert.equal(h.manager.get('mars')?.tier, 2);
  }
});

test('obsolete captured error/load events cannot interrupt an already-started decode or run it twice', async t => {
  const h = new Harness(t); h.step(0, demand('moon', 100)); const image = h.image('moon', 2);
  const load = image.onload!, error = image.onerror!; await h.beginDecode(image);
  await h.callback(() => { error(); load(); }); h.step(1);
  assert.equal(h.manager.getStats().failuresTotal, 0); assert.equal(h.manager.getStats().decoding, 1);
  assert.equal(image.decodeCalls, 1); await h.callback(() => image.resolve()); h.step(2);
  assert.equal(h.manager.getStats().uploads, 1); assert.equal(h.manager.get('moon')?.tier, 2);
});

test('cancellation between onload and decode microtask does not invoke the obsolete decoder', async t => {
  const h = new Harness(t, { maxConcurrentBaseLoads: 1 }); h.step(0, demand('moon', 100));
  const image = h.image('moon', 2), count = h.gl.calls.length; image.load();
  assert.equal(h.gl.calls.length, count); assert.equal(image.decodeCalls, 0);
  h.step(1, demand('mars', 100)); await flush(); assert.equal(image.decodeCalls, 0);
  assert.equal(h.manager.getStats().draining, 0); h.step(2); assert.equal(h.images.length, 2);
  assert.equal(h.manager.getStats().uploads, 0);
});

test('an impossible upgrade does not evict unrelated LRU victims speculatively', async t => {
  const h = new Harness(t, { gpuBudgetBytes: B4 + 2 * B2 }); const old = await four(h);
  h.step(200, demand('mars', 100)); await h.finish(h.image('mars', 2)); h.step(201);
  const mars = h.manager.get('mars')!.texture as Texture;
  h.step(210, demand()); h.step(310);
  assert.equal(h.images.length, 3); assert.equal(h.gl.deleted.length, 0);
  assert.ok(h.gl.live.has(mars)); assert.equal(h.manager.get('moon')?.texture, old);
});

test('projected-centre motion distinguishes coherent slow pan from locked narrow-field tracking', async t => {
  const c = { ...CAMERA, altitudeDeg: 0, fovDeg: 0.0001 };
  for (const locked of [true, false]) {
    const h = new Harness(t);
    const projected = (x: number): PlanetTextureDemand[] => [{ ...demand()[0], screenPosition: [x, 0] }];
    h.step(0, projected(0), c); await h.finish(h.image('moon', 2)); h.step(1);
    for (let i = 1; i <= 4; i++) {
      h.step(i * 250, projected(locked ? 0 : i * 0.01), { ...c, azimuthDeg: c.azimuthDeg + i * 0.001 });
    }
    assert.equal(h.manager.getStats().stable, locked);
    assert.equal(h.manager.getStats().hdLoading, Number(locked));
    assert.equal(h.images.length, locked ? 2 : 1);
  }
});

test('small projected-centre displacements accumulate and cancel a pending upgrade', async t => {
  const h = new Harness(t);
  const projected = (x: number): PlanetTextureDemand[] => [{ ...demand()[0], screenPosition: [x, 0] }];
  h.step(0, projected(0)); await h.finish(h.image('moon', 2)); h.step(1); h.step(100);
  const pending = h.image('moon', 8);
  for (let i = 1; i <= 5; i++) h.step(100 + i * 10, projected(i * 0.0005));
  assert.equal(pending.src, ''); assert.equal(h.manager.getStats().stable, false);
  assert.equal(h.manager.getStats().hdLoading, 0); assert.equal(h.manager.get('moon')?.tier, 2);
});


test('observation-only explicit sources never merge old maps or request unsupported targets',async t=>{
 const h=new Harness(t,{sources:{moon:{2:'./observations/maps/moon-2k.jpg',4:'./observations/maps/moon-4k.jpg'}}});
 h.step(0,[{id:'moon',devicePixelDiameter:2500},{id:'mars',devicePixelDiameter:2400},{id:'saturn-ring',devicePixelDiameter:900}]);
 assert.equal(h.images.length,1);assert.equal(h.images[0].requestedUrl,'./observations/maps/moon-2k.jpg');
 const image=h.images[0];await h.callback(()=>{image.naturalWidth=2048;image.naturalHeight=1024;image.onload?.();image.resolve();});h.step(1);assert.equal(h.manager.get('moon')?.tier,2);
 h.step(150);assert.equal(h.images.at(-1)!.requestedUrl,'./observations/maps/moon-4k.jpg');assert.ok(h.images.every(i=>i.requestedUrl.startsWith('./observations/maps/')));
 h.images.at(-1)!.error();h.step(151);assert.equal(h.manager.get('moon')?.tier,2,'failed higher tier retains verified base, never old artistic fallback');
});
test('empty or invalid observation allowlists disable all texture downloads',t=>{
 for(const sources of [{},{moon:{4:'./observations/maps/missing-base.jpg'}},{moon:{2:'https://unverified.example/map.jpg'}},{moon:{2:'./textures/2k_moon.jpg'}}]){
  const h=new Harness(t,{sources:sources as any});h.step(0,[...demand('earth'),...demand('moon'),...demand('saturn-ring')]);h.step(1000);assert.equal(h.images.length,0);assert.equal(h.manager.getStats().requested,0);
 }
});
