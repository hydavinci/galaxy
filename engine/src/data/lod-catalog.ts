export interface LODLevel {
  magMin: number;
  magMax: number;
  file: string;
  data: Float32Array | null;
  loaded: boolean;
  loading: boolean;
  minFov: number; // radians - only load when FOV < this
}

export class LODCatalog {
  private levels: LODLevel[] = [
    { magMin: -2, magMax: 4, file: './data/stars-lod0.bin', data: null, loaded: false, loading: false, minFov: Math.PI },
    { magMin: 4, magMax: 5.5, file: './data/stars-lod1.bin', data: null, loaded: false, loading: false, minFov: Math.PI },
    { magMin: 5.5, magMax: 7, file: './data/stars-lod2.bin', data: null, loaded: false, loading: false, minFov: Math.PI },
    { magMin: 7, magMax: 9, file: './data/stars-lod3.bin', data: null, loaded: false, loading: false, minFov: Math.PI },
    { magMin: 9, magMax: 11, file: './data/stars-lod4.bin', data: null, loaded: false, loading: false, minFov: Math.PI },
    { magMin: 9, magMax: 11, file: './data/stars-lod5.bin', data: null, loaded: false, loading: false, minFov: Math.PI },
    { magMin: 11, magMax: 13, file: './data/stars-lod6.bin', data: null, loaded: false, loading: false, minFov: Math.PI },
    { magMin: 13, magMax: 15, file: './data/stars-lod7.bin', data: null, loaded: false, loading: false, minFov: 30 * Math.PI / 180 },
  ];

  private merged: Float32Array | null = null;
  private dirty = true;
  private totalStars = 0;

  async init() {
    // Load levels 0-6 immediately (always visible stars up to mag 13)
    await Promise.all(this.levels.slice(0, 7).map(l => this.loadLevel(l)));
  }

  update(fov: number) {
    for (const level of this.levels) {
      if (!level.loaded && !level.loading && fov <= level.minFov) {
        this.loadLevel(level);
      }
    }
  }

  private async loadLevel(level: LODLevel) {
    level.loading = true;
    try {
      const resp = await fetch(level.file);
      if (!resp.ok) {
        level.loading = false;
        return;
      }
      const buf = await resp.arrayBuffer();
      level.data = new Float32Array(buf);
      level.loaded = true;
      this.dirty = true;
    } catch {
      // silently fail for missing LOD files
    }
    level.loading = false;
  }

  isDirty(): boolean { return this.dirty; }

  getStarBuffer(): Float32Array {
    if (this.dirty) {
      const loaded = this.levels.filter(l => l.loaded && l.data);
      const totalFloats = loaded.reduce((s, l) => s + l.data!.length, 0);
      this.merged = new Float32Array(totalFloats);
      let offset = 0;
      for (const l of loaded) {
        this.merged.set(l.data!, offset);
        offset += l.data!.length;
      }
      this.totalStars = totalFloats / 4;
      this.dirty = false;
    }
    return this.merged || new Float32Array(0);
  }

  getStarCount(): number { return this.totalStars; }
}
