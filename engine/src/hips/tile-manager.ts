/**
 * HiPS tile manager: async loading, LRU cache, LOD selection.
 */

export interface HipsTile {
  order: number;
  pix: number;
  texture: WebGLTexture | null;
  loading: boolean;
  loaded: boolean;
  error: boolean;
  lastUsed: number; // timestamp for LRU
  img?: HTMLImageElement;
}

export interface HipsConfig {
  url: string;           // Base URL of the HiPS survey
  maxOrder: number;      // Maximum tile order to request
  tileSize: number;      // Tile width in px (usually 512)
  format: string;        // 'jpg' or 'png'
  frame: 'galactic' | 'equatorial'; // Coordinate frame
}

const MAX_CACHE_TILES = 200;
const MAX_CONCURRENT_LOADS = 6;

export class HipsTileManager {
  private tiles: Map<string, HipsTile> = new Map();
  private loadQueue: Array<{ order: number; pix: number }> = [];
  private activeLoads = 0;
  private gl: WebGL2RenderingContext;
  private config: HipsConfig;

  constructor(gl: WebGL2RenderingContext, config: HipsConfig) {
    this.gl = gl;
    this.config = config;
  }

  /**
   * Get or create a tile. Returns the tile (may be loading).
   */
  getTile(order: number, pix: number): HipsTile {
    const key = `${order}/${pix}`;
    let tile = this.tiles.get(key);
    if (tile) {
      tile.lastUsed = performance.now();
      return tile;
    }

    tile = {
      order,
      pix,
      texture: null,
      loading: false,
      loaded: false,
      error: false,
      lastUsed: performance.now(),
    };
    this.tiles.set(key, tile);
    return tile;
  }

  /**
   * Request tile loading if not already loaded/loading.
   */
  requestTile(order: number, pix: number): HipsTile {
    const tile = this.getTile(order, pix);
    if (!tile.loaded && !tile.loading && !tile.error) {
      this.enqueueLoad(order, pix);
    }
    return tile;
  }

  /**
   * Get a loaded tile or the best available ancestor.
   */
  getTileOrAncestor(order: number, pix: number): HipsTile | null {
    // First try exact tile
    const tile = this.requestTile(order, pix);
    if (tile.loaded) return tile;

    // Walk up to ancestors
    let o = order - 1;
    let p = Math.floor(pix / 4);
    while (o >= 0) {
      const key = `${o}/${p}`;
      const ancestor = this.tiles.get(key);
      if (ancestor && ancestor.loaded) return ancestor;
      // Also request it so it loads
      this.requestTile(o, p);
      o--;
      p = Math.floor(p / 4);
    }
    return null;
  }

  private enqueueLoad(order: number, pix: number) {
    const key = `${order}/${pix}`;
    const tile = this.tiles.get(key)!;
    tile.loading = true;
    this.loadQueue.push({ order, pix });
    this.processQueue();
  }

  private processQueue() {
    while (this.activeLoads < MAX_CONCURRENT_LOADS && this.loadQueue.length > 0) {
      const item = this.loadQueue.shift()!;
      this.activeLoads++;
      this.loadTile(item.order, item.pix);
    }
  }

  private loadTile(order: number, pix: number) {
    const key = `${order}/${pix}`;
    const tile = this.tiles.get(key);
    if (!tile) { this.activeLoads--; return; }

    const dir = Math.floor(pix / 10000) * 10000;
    const url = `${this.config.url}/Norder${order}/Dir${dir}/Npix${pix}.${this.config.format}`;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      tile.texture = tex;
      tile.loaded = true;
      tile.loading = false;
      this.activeLoads--;
      this.evictIfNeeded();
      this.processQueue();
    };
    img.onerror = () => {
      tile.error = true;
      tile.loading = false;
      this.activeLoads--;
      this.processQueue();
    };
    img.src = url;
  }

  private evictIfNeeded() {
    if (this.tiles.size <= MAX_CACHE_TILES) return;

    // Find and remove oldest unused tiles
    const entries = [...this.tiles.entries()]
      .filter(([_, t]) => t.loaded && !t.loading)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    const toRemove = this.tiles.size - MAX_CACHE_TILES;
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      const [key, tile] = entries[i];
      if (tile.texture) {
        this.gl.deleteTexture(tile.texture);
      }
      this.tiles.delete(key);
    }
  }

  getConfig(): HipsConfig { return this.config; }

  hasLoadedTilesAtOrder(order: number): boolean {
    for (const [key, tile] of this.tiles) {
      if (tile.order === order && tile.loaded) return true;
    }
    return false;
  }
}
