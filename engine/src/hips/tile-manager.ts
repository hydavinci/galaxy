/** Bounded, view-prioritised HiPS loading and ancestor texture fallback. */
import type { VisibleTile } from './visibility';

export interface HipsTile {
  order: number;
  pix: number;
  texture: WebGLTexture | null;
  loading: boolean;
  loaded: boolean;
  error: boolean;
  lastUsed: number;
  img?: HTMLImageElement;
  queued?: boolean;
  priority?: number;
  cancel?: () => void;
}

export interface HipsConfig {
  url: string;
  maxOrder: number;
  tileSize: number;
  format: string;
  frame: 'galactic' | 'equatorial';
  /** Opt in to atomic whole-sky coverage from 12 pinned order-0 textures. */
  requireCompleteBase?: boolean;
  /** Optional resource limits; defaults also work without navigator (CPU tests). */
  maxCacheTiles?: number;
  maxConcurrentLoads?: number;
  maxQueuedLoads?: number;
  maxVisibleTiles?: number;
  maxMeshTiles?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  loadTimeoutMs?: number;
}

export interface HipsTileStats {
  loaded: number;
  loading: number;
  queued: number;
  failed: number;
  failuresTotal: number;
  cached: number;
  requested: number;
  maxCacheTiles: number;
  maxConcurrentLoads: number;
  maxQueuedLoads: number;
  baseLoaded: number;
  baseReady: boolean;
  /** Roots whose finite retry budget is exhausted (not transient failures). */
  baseFailed: number;
  detailFailed: number;
  /** Cumulative CPU work counters, not browser timing/FPS. */
  queueRebuilds: number;
  queueSorts: number;
}

function lowMemory(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return nav.maxTouchPoints > 0 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;
}

interface Failure { attempts: number; retryAt: number }

export class HipsTileManager {
  private tiles = new Map<string, HipsTile>();
  private loadQueue: HipsTile[] = [];
  private failures = new Map<string, Failure>();
  private activeLoads = 0;
  private disposed = false;
  private clock = 0;
  private requested = 0;
  private failuresTotal = 0;
  private wanted = new Set<string>();
  private protectedTextures = new Set<string>();
  private maxCache: number;
  private maxConcurrent: number;
  private maxQueue: number;
  private maxRetries: number;
  private retryDelay: number;
  private timeoutMs: number;
  private previousVisible: VisibleTile[] | null = null;
  private queueDirty = true;
  private queueNeedsSort = false;
  private queueSettled = false;
  private nextRetryAt = Infinity;
  private queueRebuilds = 0;
  private queueSorts = 0;

  constructor(private gl: WebGL2RenderingContext, private config: HipsConfig) {
    const mobile = lowMemory();
    this.maxCache = bounded(config.maxCacheTiles, mobile ? 96 : 200, 12, 512);
    this.maxConcurrent = bounded(config.maxConcurrentLoads, mobile ? 3 : 6, 1, 12);
    this.maxQueue = bounded(config.maxQueuedLoads, 64, 1, this.maxCache - this.maxConcurrent);
    this.maxRetries = bounded(config.maxRetries, 1, 0, 3);
    this.retryDelay = bounded(config.retryDelayMs, 5000, 100, 60000);
    this.timeoutMs = bounded(config.loadTimeoutMs, 15000, 100, 60000);
  }

  private key(order: number, pix: number): string { return `${order}/${pix}`; }

  private baseLoaded(): number {
    let loaded = 0;
    for (let pix = 0; pix < 12; pix++) {
      const tile = this.tiles.get(this.key(0, pix));
      if (tile?.loaded && tile.texture) loaded++;
    }
    return loaded;
  }

  private remove(key: string, tile: HipsTile): void {
    this.queueDirty = true;
    if (tile.texture) this.gl.deleteTexture(tile.texture);
    tile.texture = null;
    tile.loaded = false;
    this.tiles.delete(key);
  }

  private makeRoom(): boolean {
    if (this.tiles.size < this.maxCache) return true;
    const candidates = [...this.tiles.entries()].filter(([key, t]) =>
      !t.loading && !t.queued && !this.protectedTextures.has(key) &&
      !(this.config.requireCompleteBase && t.order === 0));
    // Retain currently visible fallbacks, then coarse coverage; LRU within class.
    candidates.sort(([ka, a], [kb, b]) =>
      Number(this.wanted.has(ka)) - Number(this.wanted.has(kb)) ||
      (b.order - a.order) || a.lastUsed - b.lastUsed);
    if (!candidates.length) return false;
    this.remove(...candidates[0]);
    return true;
  }

  /** Kept for compatibility. Cache-full requests may return an uncached placeholder. */
  getTile(order: number, pix: number): HipsTile {
    const key = this.key(order, pix);
    const cached = this.tiles.get(key);
    if (cached) { cached.lastUsed = ++this.clock; return cached; }
    const tile: HipsTile = { order, pix, texture: null, loaded: false, loading: false,
      error: this.failures.has(key), lastUsed: ++this.clock };
    if (!this.disposed && this.makeRoom()) this.tiles.set(key, tile);
    return tile;
  }

  private retryAllowed(key: string): boolean {
    const failure = this.failures.get(key);
    return !failure || (failure.attempts <= this.maxRetries && Date.now() >= failure.retryAt);
  }

  requestTile(order: number, pix: number, priority = 1000 - order): HipsTile {
    this.queueDirty = true;
    if (this.config.requireCompleteBase && this.baseLoaded() < 12) {
      this.updateVisibleTiles([{ order, pix, priority }]);
      return this.getTile(order, pix);
    }
    return this.enqueue(order, pix, priority, true);
  }

  private enqueue(order: number, pix: number, priority: number, pump: boolean): HipsTile {
    const key = this.key(order, pix);
    const tile = this.tiles.get(key) ?? this.getTile(order, pix);
    tile.lastUsed = ++this.clock;
    if (this.disposed || tile.loaded || tile.loading || !this.retryAllowed(key)) return tile;
    if (tile.queued) {
      const next = Math.max(tile.priority ?? -Infinity, priority);
      if (next !== tile.priority) this.queueNeedsSort = true;
      tile.priority = next;
      return tile;
    }
    if (!this.tiles.has(key)) return tile;
    if (this.loadQueue.length >= this.maxQueue) {
      this.sortQueue();
      const worst = this.loadQueue[this.loadQueue.length - 1];
      if ((worst.priority ?? 0) >= priority) return tile;
      this.loadQueue.pop();
      worst.queued = false;
    }
    tile.queued = true;
    tile.priority = priority;
    this.loadQueue.push(tile);
    this.queueNeedsSort = true;
    if (pump) this.processQueue();
    return tile;
  }

  /** Replace stale pending work on every view change; never preload full detail.
   * Ancestor closure is independent of target selection. Parents load first to
   * supply coverage, but do not change/lock the requested target LOD. Opt-in
   * complete-base mode loads all 12 roots through this same bounded queue first.
   */
  updateVisibleTiles(visible: readonly VisibleTile[]): void {
    if (this.disposed) return;
    // Compare values, not array identity: callers may allocate each RAF or mutate
    // the same array. A completion/eviction/direct request/backoff deadline also
    // invalidates this cache; an unchanged view must still progress to detail.
    if (!this.queueDirty && Date.now() < this.nextRetryAt && this.previousVisible &&
      visible.length === this.previousVisible.length && visible.every((tile, i) => {
        const previous = this.previousVisible![i];
        return tile.order === previous.order && tile.pix === previous.pix &&
          (this.queueSettled || tile.priority === previous.priority);
      })) return;
    this.queueDirty = false;
    this.previousVisible = visible.map(tile => ({ ...tile }));
    this.nextRetryAt = Infinity;
    this.queueRebuilds++;
    for (const tile of this.loadQueue) tile.queued = false;
    this.loadQueue = [];
    this.wanted.clear();
    this.protectedTextures.clear();
    const candidates = new Map<string, { order: number; pix: number; priority: number }>();
    if (this.config.requireCompleteBase) {
      for (let pix = 0; pix < 12; pix++) {
        const key = this.key(0, pix);
        candidates.set(key, { order: 0, pix, priority: 2000 });
        this.wanted.add(key);
      }
    }
    // A failed/pending root must never be bypassed by spending the remaining
    // budget on detail. Retry timing/caps remain the ordinary queue's policy.
    const targets = this.config.requireCompleteBase && this.baseLoaded() < 12 ? [] : visible;
    for (const target of targets) {
      const fallback = this.getTileOrAncestor(target.order, target.pix, false);
      if (fallback) this.protectedTextures.add(this.key(fallback.order, fallback.pix));
      let pix = target.pix;
      for (let order = target.order; order >= 0; order--, pix = Math.floor(pix / 4)) {
        const key = this.key(order, pix);
        // Coarse-to-fine and then centre-to-edge; shared ancestors deduplicated.
        const priority = 1000 - order * 10 + (target.priority ?? 0);
        const old = candidates.get(key);
        if (!old || old.priority < priority) candidates.set(key, { order, pix, priority });
        this.wanted.add(key);
        // This resident texture already covers the target. Requesting still
        // coarser ancestors cannot improve it and can endlessly reload/evict
        // them in a small cache even after every visible leaf is exact. Other
        // targets build their own closure; complete-base roots remain pinned.
        if (fallback && order === fallback.order) break;
      }
    }
    const sorted = [...candidates.values()].sort((a, b) => b.priority - a.priority);
    for (const key of candidates.keys()) {
      const failure = this.failures.get(key);
      if (failure && failure.attempts <= this.maxRetries && failure.retryAt > Date.now())
        this.nextRetryAt = Math.min(this.nextRetryAt, failure.retryAt);
    }
    for (const c of sorted) {
      if (this.loadQueue.length >= this.maxQueue) break;
      const cached = this.tiles.get(this.key(c.order, c.pix));
      if (cached?.loaded || cached?.loading || !this.retryAllowed(this.key(c.order, c.pix))) continue;
      this.enqueue(c.order, c.pix, c.priority, false);
    }
    // Candidates were enqueued in descending priority already.
    this.queueNeedsSort = false;
    // With the entire wanted set resident, changed centre-distance priorities
    // cannot change any request. Same ordered leaves may keep moving each RAF
    // without rebuilding a settled queue; view/geometry are not cached here.
    this.queueSettled = sorted.every(c => this.tiles.get(this.key(c.order, c.pix))?.loaded);
    this.processQueue();
  }

  /** Selection never draws an ancestor mesh: only its texture is returned. */
  getTileOrAncestor(order: number, pix: number, request = true): HipsTile | null {
    let result: HipsTile | null = null;
    for (let o = order, p = pix; o >= 0; o--, p = Math.floor(p / 4)) {
      const tile = this.tiles.get(this.key(o, p));
      if (!result && tile?.loaded && tile.texture) {
        tile.lastUsed = ++this.clock;
        result = tile;
        // Exact match needs no further fallback requests.
        if (o === order) return result;
      }
      if (request && !tile?.loaded) this.requestTile(o, p);
    }
    return result;
  }

  private sortQueue(): void {
    if (!this.queueNeedsSort) return;
    if (this.loadQueue.length > 1) {
      this.loadQueue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      this.queueSorts++;
    }
    this.queueNeedsSort = false;
  }

  private processQueue(): void {
    if (this.disposed || this.activeLoads >= this.maxConcurrent) return;
    this.sortQueue();
    while (this.activeLoads < this.maxConcurrent && this.loadQueue.length) {
      const tile = this.loadQueue.shift()!;
      tile.queued = false;
      if (!tile.loaded && !tile.loading) this.loadTile(tile);
    }
  }

  private loadTile(tile: HipsTile): void {
    const key = this.key(tile.order, tile.pix);
    tile.loading = true;
    tile.error = false;
    this.activeLoads++;
    this.requested++;
    let img: HTMLImageElement | undefined;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // All outcomes, including decode/upload exceptions and timeouts, release a
    // slot exactly once. Late callbacks after disposal cannot resurrect a tile.
    const finish = (failed: boolean, cancelled = false) => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      if (img) {
        img.onload = null;
        img.onerror = null;
        if (failed || cancelled) { try { img.src = ''; } catch { /* already detached */ } }
      }
      tile.img = undefined;
      tile.cancel = undefined;
      tile.loading = false;
      this.activeLoads--;
      this.queueDirty = true;
      if (failed && !cancelled && !this.disposed) {
        tile.error = true;
        this.failuresTotal++;
        const attempts = (this.failures.get(key)?.attempts ?? 0) + 1;
        this.failures.delete(key);
        this.failures.set(key, { attempts, retryAt: Date.now() + this.retryDelay * 2 ** (attempts - 1) });
        // Negative cache is also bounded, independently of texture eviction.
        while (this.failures.size > this.maxCache) {
          const oldest = [...this.failures.keys()].find(k => !this.config.requireCompleteBase || !k.startsWith('0/'))!;
          this.failures.delete(oldest);
        }
      }
      if (!cancelled) this.processQueue();
    };
    tile.cancel = () => finish(false, true);
    try {
      img = new Image();
      tile.img = img;
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (finished || this.disposed) return;
        const gl = this.gl;
        let texture: WebGLTexture | null = null;
        const oldBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
        const oldFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
        try {
          if (!(img!.naturalWidth > 0 && img!.naturalHeight > 0)) throw new Error('Empty HiPS image');
          texture = gl.createTexture();
          if (!texture) throw new Error('HiPS texture allocation failed');
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img!);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          tile.texture = texture;
          tile.loaded = true;
          tile.error = false;
          this.failures.delete(key);
        } catch {
          if (texture) gl.deleteTexture(texture);
          finish(true);
          return;
        } finally {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, oldFlip);
          gl.bindTexture(gl.TEXTURE_2D, oldBinding);
        }
        finish(false);
      };
      img.onerror = () => finish(true);
      timer = setTimeout(() => finish(true), this.timeoutMs);
      const dir = Math.floor(tile.pix / 10000) * 10000;
      img.src = `${this.config.url.replace(/\/$/, '')}/Norder${tile.order}/Dir${dir}/Npix${tile.pix}.${this.config.format}`;
    } catch { finish(true); }
  }

  getConfig(): HipsConfig { return this.config; }
  getTileCount(): number { return this.getStats().loaded; }
  getMaxCacheTiles(): number { return this.maxCache; }
  hasLoadedTilesAtOrder(order: number): boolean {
    return [...this.tiles.values()].some(tile => tile.order === order && tile.loaded);
  }
  getStats(): HipsTileStats {
    const baseLoaded = this.baseLoaded();
    let baseFailed = 0, detailFailed = 0;
    for (const [key, failure] of this.failures) {
      if (!key.startsWith('0/')) detailFailed++;
      else if (failure.attempts > this.maxRetries) baseFailed++;
    }
    return {
      loaded: [...this.tiles.values()].filter(t => t.loaded && t.texture).length,
      loading: this.activeLoads, queued: this.loadQueue.length, failed: this.failures.size,
      failuresTotal: this.failuresTotal, cached: this.tiles.size, requested: this.requested,
      maxCacheTiles: this.maxCache, maxConcurrentLoads: this.maxConcurrent, maxQueuedLoads: this.maxQueue,
      baseLoaded, baseReady: baseLoaded === 12, baseFailed, detailFailed,
      queueRebuilds: this.queueRebuilds, queueSorts: this.queueSorts,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, tile] of this.tiles) {
      tile.cancel?.();
      this.remove(key, tile);
    }
    this.loadQueue = [];
    this.failures.clear();
    this.wanted.clear();
    this.protectedTextures.clear();
    this.previousVisible = null;
  }
}
