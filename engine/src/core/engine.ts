import { Camera } from './camera';
import { Input } from './input';
import { TimeSystem } from './time';
import { StarRenderer } from '../render/star-renderer';
import { GridRenderer } from '../render/grid-renderer';
import { LabelRenderer } from '../render/label-renderer';
import { ConstellationRenderer } from '../render/constellation-renderer';
import { PlanetRenderer, PLANET_ANGULAR_SIZE, PLANET_POINT_SIZE } from '../render/planet-renderer';
import { AtmosphereRenderer } from '../render/atmosphere-renderer';
import { HipsRenderer } from '../hips';
import { SolarSystemView } from '../render/solar-system-view';
import { getAllPlanets } from '../astro/planets';

export class Engine {
  private gl: WebGL2RenderingContext;
  private camera: Camera;
  private input: Input;
  private time: TimeSystem;
  private starRenderer!: StarRenderer;
  private gridRenderer!: GridRenderer;
  private labelRenderer!: LabelRenderer;
  private constellationRenderer!: ConstellationRenderer;
  private planetRenderer!: PlanetRenderer;
  private atmosphereRenderer!: AtmosphereRenderer;
  private hipsRenderer!: HipsRenderer;
  private showGrid = false;
  private showConstellations = false;
  private selectedRa: number | null = null;
  private selectedDec: number | null = null;
  private selectedMag: number | null = null;
  private selectedAngSize: number | null = null;
  private selectedName: string | null = null;
  private solarSystemView!: SolarSystemView;
  private hud: HTMLElement;
  private debugOverlay: HTMLElement | null = null;
  private lastPlanetUpdate = 0;
  private frameCount = 0;
  private lastFpsUpdate = performance.now();
  private fps = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.camera = new Camera();
    this.input = new Input(canvas, this.camera);
    this.time = new TimeSystem();
    this.hud = document.getElementById('hud')!;
    this.setupDebugOverlay();

    this.setupToolbar();
    this.setupInfoPanel();
  }

  private setupDebugOverlay() {
    const params = new URLSearchParams(window.location.search);
    const enabled = params.has('debug') || localStorage.getItem('galaxyDebug') === '1';
    if (!enabled) return;

    this.debugOverlay = document.createElement('div');
    this.debugOverlay.id = 'debug-overlay';
    this.debugOverlay.style.cssText = 'position:absolute;right:12px;bottom:12px;color:#9cf;background:rgba(5,8,18,0.72);border:1px solid rgba(100,140,255,0.25);border-radius:6px;padding:8px 10px;font:11px monospace;line-height:1.5;pointer-events:none;white-space:pre;';
    document.body.appendChild(this.debugOverlay);
  }

  private setupToolbar() {
    document.getElementById('btn-grid')!.addEventListener('click', (e) => {
      this.showGrid = !this.showGrid;
      (e.target as HTMLElement).classList.toggle('active', this.showGrid);
    });

    document.getElementById('btn-const')!.addEventListener('click', (e) => {
      this.showConstellations = !this.showConstellations;
      (e.target as HTMLElement).classList.toggle('active', this.showConstellations);
    });

    document.getElementById('btn-solar')!.addEventListener('click', () => {
      if (this.solarSystemView.isVisible()) {
        this.solarSystemView.hide();
      } else {
        this.solarSystemView.show(this.time.getJD(), this.time);
      }
    });

    // Time controls
    document.getElementById('btn-rw')!.addEventListener('click', () => {
      this.time.rewind();
      this.updateTimeLabel();
    });
    document.getElementById('btn-pause')!.addEventListener('click', () => {
      this.time.togglePause();
      this.updateTimeLabel();
    });
    document.getElementById('btn-ff')!.addEventListener('click', () => {
      this.time.fastForward();
      this.updateTimeLabel();
    });
  }

  private updateTimeLabel() {
    const el = document.getElementById('time-speed');
    if (el) el.textContent = this.time.getSpeedLabel();
  }

  private setupInfoPanel() {
    // Click handler for star/planet info
    const panel = document.getElementById('info-panel')!;
    document.getElementById('info-close')!.addEventListener('click', () => {
      panel.style.display = 'none';
      this.selectedRa = null;
      this.selectedDec = null;
      this.selectedMag = null;
      document.getElementById('selection-marker')!.style.display = 'none';
    });
  }

  showInfo(data: { name: string; type: string; ra?: number; dec?: number; mag?: number; bv?: number; con?: string; color?: string; angSize?: number }) {
    this.selectedRa = data.ra ?? null;
    this.selectedDec = data.dec ?? null;
    this.selectedMag = data.mag ?? null;
    this.selectedAngSize = data.angSize ?? null;
    this.selectedName = data.name ?? null;
    const panel = document.getElementById('info-panel')!;
    const body = document.getElementById('info-body')!;

    let html = `<h3 style="color:${data.color || '#8af'};margin:0 0 12px">${data.name}</h3>`;
    html += `<div class="info-row"><span>Type</span><span>${data.type}</span></div>`;
    if (data.ra !== undefined) {
      const rah = (data.ra * 12 / Math.PI);
      const h = Math.floor(rah);
      const m = Math.floor((rah - h) * 60);
      const s = ((rah - h - m/60) * 3600).toFixed(1);
      html += `<div class="info-row"><span>RA</span><span>${h}h ${m}m ${s}s</span></div>`;
    }
    if (data.dec !== undefined) {
      const decd = data.dec * 180 / Math.PI;
      const sign = decd >= 0 ? '+' : '-';
      const abs = Math.abs(decd);
      const d = Math.floor(abs);
      const m = Math.floor((abs - d) * 60);
      html += `<div class="info-row"><span>Dec</span><span>${sign}${d}° ${m}'</span></div>`;
    }
    if (data.mag !== undefined) html += `<div class="info-row"><span>Magnitude</span><span>${data.mag.toFixed(2)}</span></div>`;
    if (data.bv !== undefined) html += `<div class="info-row"><span>B-V</span><span>${data.bv.toFixed(2)}</span></div>`;
    if (data.con) html += `<div class="info-row"><span>Constellation</span><span>${data.con}</span></div>`;

    body.innerHTML = html;
    panel.style.display = 'block';
  }

  getCamera(): Camera { return this.camera; }

  async init() {
    const gl = this.gl;
    gl.clearColor(2/255, 3/255, 8/255, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.starRenderer = new StarRenderer(gl);
    await this.starRenderer.init();

    this.gridRenderer = new GridRenderer(gl);
    this.gridRenderer.init();

    this.labelRenderer = new LabelRenderer();
    await this.labelRenderer.init(this.camera);

    this.constellationRenderer = new ConstellationRenderer(gl);
    this.constellationRenderer.init();

    this.atmosphereRenderer = new AtmosphereRenderer(gl);
    this.atmosphereRenderer.init();

    this.hipsRenderer = new HipsRenderer(gl, {
      url: 'https://alasky.cds.unistra.fr/MellingerRGB',
      maxOrder: 3,
      tileSize: 512,
      format: 'jpg',
      frame: 'galactic',
    });
    this.hipsRenderer.init();

    this.planetRenderer = new PlanetRenderer(gl);
    this.planetRenderer.init();

    this.solarSystemView = new SolarSystemView();

    // Initial planet positions
    this.updatePlanets();


    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Listen for goto-star events
    window.addEventListener('goto-star', ((e: CustomEvent) => {
      const { ra, dec } = e.detail;
      this.camera.lookAt(ra, dec);
    }) as EventListener);

    // Canvas click: find nearest star/planet
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this.handleStarClick(cx, cy);
    });

    // Label clicks (star-labels div created by LabelRenderer)
    document.getElementById('star-labels')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.planet) {
        const pos = (window as any).__planetPositions?.[target.dataset.planet];
        const planets = this.planetRenderer.getPlanets();
        const p = planets.find((pl: any) => pl.name === target.dataset.planet);
        this.showInfo({ name: target.dataset.planet, type: 'Planet', ra: pos?.ra, dec: pos?.dec, mag: p?.mag, color: target.style.color, angSize: PLANET_ANGULAR_SIZE[target.dataset.planet] });
      } else if (target.dataset.star) {
        const stars = this.labelRenderer.getNamedStars();
        const s = stars.find((st: any) => st.name === target.dataset.star);
        if (s) this.showInfo({ name: s.name, type: 'Star', ra: s.ra, dec: s.dec, mag: s.mag, bv: s.bv });
      }
    });

    this.loop();
  }

  private updatePlanets() {
    const planets = getAllPlanets(this.time.getJD());
    this.planetRenderer.updatePlanets(planets);
    // Expose positions for search
    const pos: Record<string, {ra: number; dec: number}> = {};
    for (const p of planets) pos[p.name] = { ra: p.ra, dec: p.dec };
    (window as any).__planetPositions = pos;
  }

  private handleStarClick(cx: number, cy: number) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const aspect = w / h;
    const view = this.camera.getViewMatrix();
    const proj = this.camera.getProjMatrix(aspect);

    // Helper: project 3D direction to screen coords
    const project = (x: number, y: number, z: number): [number, number, number] | null => {
      // view transform
      const vx = view[0]*x + view[4]*y + view[8]*z;
      const vy = view[1]*x + view[5]*y + view[9]*z;
      const vz = view[2]*x + view[6]*y + view[10]*z;
      if (vz > 0) return null; // behind camera
      // proj transform
      const px = proj[0]*vx;
      const py = proj[5]*vy;
      const pw = -vz;
      const ndcX = px / pw;
      const ndcY = py / pw;
      const sx = (ndcX * 0.5 + 0.5) * w;
      const sy = (1 - (ndcY * 0.5 + 0.5)) * h;
      return [sx, sy, vz];
    };

    let best: { name: string; type: string; ra: number; dec: number; mag?: number; bv?: number; angSize?: number; dist: number } | null = null;
    const maxDist = 40; // pixels

    // Check planets first
    const planets = this.planetRenderer.getPlanets();
    for (const p of planets) {
      const x = Math.cos(p.dec) * Math.cos(p.ra);
      const y = Math.sin(p.dec);
      const z = Math.cos(p.dec) * Math.sin(p.ra);
      const s = project(x, y, z);
      if (!s) continue;
      const d = Math.hypot(s[0] - cx, s[1] - cy);
      if (d < maxDist && (!best || d < best.dist)) {
        best = { name: p.name, type: 'Planet', ra: p.ra, dec: p.dec, angSize: PLANET_ANGULAR_SIZE[p.name], dist: d };
      }
    }

    // Check named stars
    const namedStars = this.labelRenderer.getNamedStars();
    for (const star of namedStars) {
      const x = Math.cos(star.dec) * Math.cos(star.ra);
      const y = Math.sin(star.dec);
      const z = Math.cos(star.dec) * Math.sin(star.ra);
      const s = project(x, y, z);
      if (!s) continue;
      const d = Math.hypot(s[0] - cx, s[1] - cy);
      if (d < maxDist && (!best || d < best.dist)) {
        best = { name: star.name, type: 'Star', ra: star.ra, dec: star.dec, mag: star.mag, bv: star.bv, dist: d };
      }
    }

    if (best) {
      this.showInfo({ name: best.name, type: best.type, ra: best.ra, dec: best.dec, mag: best.mag, bv: best.bv, angSize: best.angSize });
    }
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private updateDebugOverlay(fov: number) {
    if (!this.debugOverlay) return;
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastFpsUpdate;
    if (elapsed >= 500) {
      this.fps = Math.round(this.frameCount * 1000 / elapsed);
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
    const gl = this.gl;
    this.debugOverlay.textContent = `FPS: ${this.fps}\nFOV: ${(fov * 180 / Math.PI).toFixed(1)}°\nCanvas: ${this.canvas.width}×${this.canvas.height}\nStars: ${this.starRenderer.getStarCount().toLocaleString()}\nHiPS tiles: ${this.hipsRenderer.getTileCount()}/${this.hipsRenderer.getMaxCacheTiles()}\nGPU: ${gl.getParameter(gl.RENDERER)}`;
  }

  private loop = () => {
    this.time.update();
    this.camera.update();
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);

    const aspect = this.canvas.width / this.canvas.height;
    const view = this.camera.getViewMatrix();
    const proj = this.camera.getProjMatrix(aspect);
    const fov = this.camera.fov;
    const viewport = [this.canvas.width, this.canvas.height] as [number, number];

    this.atmosphereRenderer.render(view, proj);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive blend
    this.hipsRenderer.render(view, proj, fov, viewport);
    this.starRenderer.render(view, proj, fov, viewport);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // restore

    if (this.showGrid) {
      this.gridRenderer.render(view, proj);
    }

    if (this.showConstellations) {
      this.constellationRenderer.render(view, proj);
    }
    this.constellationRenderer.setLabelsVisible(this.showConstellations);


    // Update planets every second
    const now = Date.now();
    if (now - this.lastPlanetUpdate > 1000) {
      this.updatePlanets();
      this.solarSystemView.updateJD(this.time.getJD());
      this.lastPlanetUpdate = now;
    }

    this.planetRenderer.render(view, proj, this.canvas.clientWidth, this.canvas.clientHeight, fov);

    // Star labels
    this.labelRenderer.render(view, proj, this.canvas.clientWidth, this.canvas.clientHeight);

    // HUD
    this.updateDebugOverlay(fov);
    const fovDeg = (fov * 180 / Math.PI).toFixed(1);
    const azDeg = ((this.camera.azimuth * 180 / Math.PI) % 360 + 360) % 360;
    const altDeg = this.camera.altitude * 180 / Math.PI;
    this.hud.innerHTML = `${this.time.getDateString()} ${this.time.getSpeedLabel()}<br>FOV: ${fovDeg}°<br>Az: ${azDeg.toFixed(1)}° Alt: ${altDeg.toFixed(1)}°`;

    // Update selection marker
    const marker = document.getElementById('selection-marker')!;
    if (this.selectedRa !== null && this.selectedDec !== null) {
      const sx = Math.cos(this.selectedDec) * Math.cos(this.selectedRa);
      const sy = Math.sin(this.selectedDec);
      const sz = Math.cos(this.selectedDec) * Math.sin(this.selectedRa);
      const vx2 = view[0]*sx + view[4]*sy + view[8]*sz;
      const vy2 = view[1]*sx + view[5]*sy + view[9]*sz;
      const vz2 = view[2]*sx + view[6]*sy + view[10]*sz;
      if (vz2 < 0) {
        const px = proj[0]*vx2;
        const py = proj[5]*vy2;
        const pw = -vz2;
        const ndcX = px / pw;
        const ndcY = py / pw;
        if (ndcX > -1.2 && ndcX < 1.2 && ndcY > -1.2 && ndcY < 1.2) {
          const screenX = (ndcX * 0.5 + 0.5) * this.canvas.clientWidth;
          const screenY = (1 - (ndcY * 0.5 + 0.5)) * this.canvas.clientHeight;
          // Selection marker: matches object's visual size on screen
          const pixelsPerRad = this.canvas.clientHeight / this.camera.fov;
          let objectRadius: number;
          if (this.selectedAngSize && this.selectedName) {
            // Compute actual screen radius matching sphere renderer
            const halfFov = this.camera.fov / 2;
            const screenRadius = (this.selectedAngSize / 2) / Math.tan(halfFov) * (this.canvas.clientHeight / 2);
            // Point glow is fixed pixel size, not FOV-dependent
            const pointSize = PLANET_POINT_SIZE[this.selectedName] || 8;
            // Blend between point glow size and sphere size based on transition
            // Planet renderer: point fades at screenPx 4-12, sphere appears
            const screenPx = this.selectedAngSize * (this.canvas.clientHeight / this.camera.fov);
            const sphereBlend = Math.min(Math.max((screenPx - 4) / 8, 0), 1);
            const pointRadius = pointSize / 6;
            objectRadius = pointRadius * (1 - sphereBlend) + screenRadius * sphereBlend;
            objectRadius = Math.max(objectRadius, 8);
          } else {
            // Star: estimate rendered point size from new shader formula
            const mag = this.selectedMag ?? 1.0;
            const fovScale = Math.min(3.0, 60.0 / (this.camera.fov * 180 / Math.PI));
            const sizeMag = Math.max(0, Math.min(1, (6.0 - mag) / 7.5));
            objectRadius = (1.5 + sizeMag * sizeMag * 35.0 * fovScale) / 2;
          }
          const gap = Math.max(6, objectRadius + 3);
          marker.style.display = 'block';
          marker.style.left = screenX + 'px';
          marker.style.top = screenY + 'px';
          marker.style.setProperty('--gap', gap + 'px');
        } else {
          marker.style.display = 'none';
        }
      } else {
        marker.style.display = 'none';
      }
    }

    requestAnimationFrame(this.loop);
  };
}
