/**
 * 3D Solar System view with WebGL orbit rendering.
 * Orbit camera with mouse drag rotation + scroll zoom.
 */
import { jdToT } from '../astro/coordinates';
import { TimeSystem } from '../core/time';

const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

interface OE { L0: number; L1: number; a: number; e0: number; e1: number; I0: number; I1: number; w0: number; w1: number; O0: number; O1: number; }

const PLANETS: Record<string, OE> = {
  Mercury: { L0: 252.2509, L1: 149472.6746, a: 0.387098, e0: 0.205635, e1: 0.000020, I0: 7.0050, I1: -0.0060, w0: 77.4561, w1: 1.5564, O0: 48.3309, O1: -0.1254 },
  Venus:   { L0: 181.9798, L1: 58517.8157, a: 0.723330, e0: 0.006773, e1: -0.000048, I0: 3.3947, I1: -0.0008, w0: 131.5637, w1: 1.4022, O0: 76.6799, O1: -0.2780 },
  Earth:   { L0: 100.4664, L1: 35999.3729, a: 1.000001, e0: 0.016709, e1: -0.000042, I0: 0.0, I1: 0.0, w0: 102.9373, w1: 1.7192, O0: 0.0, O1: 0.0 },
  Mars:    { L0: 355.4533, L1: 19140.2993, a: 1.523679, e0: 0.093405, e1: 0.000090, I0: 1.8497, I1: -0.0013, w0: 336.0602, w1: 1.8410, O0: 49.5574, O1: -0.2950 },
  Jupiter: { L0: 34.3515, L1: 3034.9057, a: 5.202887, e0: 0.048498, e1: 0.000164, I0: 1.3033, I1: -0.0020, w0: 14.3312, w1: 1.6126, O0: 100.4644, O1: 0.1768 },
  Saturn:  { L0: 50.0774, L1: 1222.1138, a: 9.536676, e0: 0.054151, e1: -0.000295, I0: 2.4889, I1: 0.0025, w0: 93.0572, w1: 1.9637, O0: 113.6634, O1: -0.2507 },
  Uranus:  { L0: 314.0550, L1: 428.4677, a: 19.18916, e0: 0.047168, e1: -0.000019, I0: 0.7732, I1: 0.0001, w0: 173.0053, w1: 1.4864, O0: 74.0060, O1: 0.0741 },
  Neptune: { L0: 304.3487, L1: 218.4862, a: 30.06992, e0: 0.008586, e1: 0.000025, I0: 1.7700, I1: -0.0003, w0: 48.1227, w1: 1.4262, O0: 131.7841, O1: -0.0061 },
};

const PLANET_COLORS: Record<string, [number, number, number]> = {
  Sun: [1.0, 0.88, 0.19], Mercury: [0.69, 0.69, 0.69], Venus: [1.0, 1.0, 0.8],
  Earth: [0.27, 0.53, 1.0], Mars: [1.0, 0.4, 0.2], Jupiter: [1.0, 0.84, 0.6],
  Saturn: [1.0, 0.8, 0.4], Uranus: [0.6, 1.0, 1.0], Neptune: [0.4, 0.6, 1.0],
};

const PLANET_PT_SIZE: Record<string, number> = {
  Sun: 18, Mercury: 5, Venus: 7, Earth: 8, Mars: 6, Jupiter: 12, Saturn: 11, Uranus: 8, Neptune: 8,
};

const ORBIT_SEGMENTS = 128;

function normAng(a: number) { return ((a % TWO_PI) + TWO_PI) % TWO_PI; }
function solveKepler(M: number, e: number) { let E = M; for (let i = 0; i < 10; i++) { const d = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E)); E += d; if (Math.abs(d) < 1e-8) break; } return E; }

function helio3D(el: OE, T: number): [number, number, number] {
  const L = (el.L0 + el.L1 * T) * DEG2RAD;
  const e = el.e0 + el.e1 * T;
  const I = (el.I0 + el.I1 * T) * DEG2RAD;
  const w = (el.w0 + el.w1 * T) * DEG2RAD;
  const O = (el.O0 + el.O1 * T) * DEG2RAD;
  const omega = w - O, M = normAng(L - w), E = solveKepler(M, e);
  const xp = el.a * (Math.cos(E) - e), yp = el.a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I), cW = Math.cos(omega), sW = Math.sin(omega);
  const x = (cO * cW - sO * sW * cI) * xp + (-cO * sW - sO * cW * cI) * yp;
  const y = (sO * cW + cO * sW * cI) * xp + (-sO * sW + cO * cW * cI) * yp;
  const z = (sW * sI) * xp + (cW * sI) * yp;
  return [x, z, -y];
}

function orbitPath3D(el: OE, T: number): Float32Array {
  const e = el.e0 + el.e1 * T, I = (el.I0 + el.I1 * T) * DEG2RAD;
  const w = (el.w0 + el.w1 * T) * DEG2RAD, O = (el.O0 + el.O1 * T) * DEG2RAD;
  const omega = w - O;
  const cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I), cW = Math.cos(omega), sW = Math.sin(omega);
  const pts = new Float32Array((ORBIT_SEGMENTS + 1) * 3);
  for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
    const M = (i / ORBIT_SEGMENTS) * TWO_PI, E = solveKepler(M, e);
    const xp = el.a * (Math.cos(E) - e), yp = el.a * Math.sqrt(1 - e * e) * Math.sin(E);
    const hx = (cO * cW - sO * sW * cI) * xp + (-cO * sW - sO * cW * cI) * yp;
    const hy = (sO * cW + cO * sW * cI) * xp + (-sO * sW + cO * cW * cI) * yp;
    const hz = (sW * sI) * xp + (cW * sI) * yp;
    pts[i * 3] = hx; pts[i * 3 + 1] = hz; pts[i * 3 + 2] = -hy;
  }
  return pts;
}

const V_LINE = `#version 300 es
precision highp float;
in vec3 a_position;
uniform mat4 u_mvp;
uniform float u_pointSize;
void main(){ gl_Position = u_mvp * vec4(a_position, 1.0); gl_PointSize = u_pointSize; }`;

const F_LINE = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 o;
void main(){ o = u_color; }`;

const F_PLANET = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 o;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c,c);
  if(d > 0.25) discard;
  o = vec4(u_color.rgb, u_color.a * smoothstep(0.25, 0.1, d));
}`;

const V_STAR = `#version 300 es
precision highp float;
in vec3 a_position;
in float a_brightness;
uniform mat4 u_mvp;
out float vB;
void main(){ gl_Position = u_mvp * vec4(a_position, 1.0); gl_PointSize = 1.0 + a_brightness * 2.0; vB = a_brightness; }`;

const F_STAR = `#version 300 es
precision highp float;
in float vB;
out vec4 o;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if(d > 0.5) discard;
  o = vec4(0.8, 0.85, 1.0, vB * smoothstep(0.5, 0.0, d));
}`;

function mat4Persp(fov: number, asp: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fov / 2), nf = 1 / (n - f);
  return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
}

function mat4Look(eye: number[], ctr: number[], up: number[]): Float32Array {
  let zx = eye[0] - ctr[0], zy = eye[1] - ctr[1], zz = eye[2] - ctr[2];
  let l = 1 / Math.sqrt(zx * zx + zy * zy + zz * zz); zx *= l; zy *= l; zz *= l;
  let rx = up[1] * zz - up[2] * zy, ry = up[2] * zx - up[0] * zz, rz = up[0] * zy - up[1] * zx;
  l = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz); rx *= l; ry *= l; rz *= l;
  const ux = zy * rz - zz * ry, uy = zz * rx - zx * rz, uz = zx * ry - zy * rx;
  return new Float32Array([rx, ux, zx, 0, ry, uy, zy, 0, rz, uz, zz, 0,
    -(rx * eye[0] + ry * eye[1] + rz * eye[2]),
    -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
}

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
    r[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
  return r;
}

function proj3D(pos: number[], mvp: Float32Array, w: number, h: number): [number, number] | null {
  const x = mvp[0] * pos[0] + mvp[4] * pos[1] + mvp[8] * pos[2] + mvp[12];
  const y = mvp[1] * pos[0] + mvp[5] * pos[1] + mvp[9] * pos[2] + mvp[13];
  const pw = mvp[3] * pos[0] + mvp[7] * pos[1] + mvp[11] * pos[2] + mvp[15];
  if (pw <= 0) return null;
  const nx = x / pw, ny = y / pw;
  if (Math.abs(nx) > 1.3 || Math.abs(ny) > 1.3) return null;
  return [(nx * 0.5 + 0.5) * w, (1 - (ny * 0.5 + 0.5)) * h];
}

export class SolarSystemView {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private visible = false;
  private jd = 2451545.0;
  private time: TimeSystem | null = null;
  private camTheta = 55 * DEG2RAD;
  private camPhi = -30 * DEG2RAD;
  private camDist = 12;
  private dragging = false;
  private lastX = 0; private lastY = 0;
  private lineP!: WebGLProgram; private planetP!: WebGLProgram; private starP!: WebGLProgram;
  private orbitVaos: WebGLVertexArrayObject[] = [];
  private orbitVbos: WebGLBuffer[] = [];
  private starVao!: WebGLVertexArrayObject; private starCount = 0;
  private planetNames = Object.keys(PLANETS);
  private animId = 0;
  private labelContainer!: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'solar-system-view';
    this.container.style.cssText = 'display:none;position:absolute;top:0;left:0;width:100%;height:100%;z-index:100;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;';
    this.container.appendChild(this.canvas);
    this.labelContainer = document.createElement('div');
    this.labelContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;font:11px -apple-system,sans-serif;';
    this.container.appendChild(this.labelContainer);
    const ctrl = document.createElement('div');
    ctrl.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:6px;';
    const s = 'background:rgba(30,40,70,0.7);border:1px solid rgba(100,140,255,0.3);color:#8af;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;';
    ctrl.innerHTML = `<button id="ss-inner" style="${s}">Inner</button><button id="ss-all" style="${s}">All</button><div style="width:1px;height:20px;background:rgba(100,140,255,0.2);margin:0 4px;"></div><button id="ss-rw" style="${s}">◀◀</button><button id="ss-pause" style="${s}">▶</button><button id="ss-ff" style="${s}">▶▶</button><span id="ss-speed" style="color:#8af;font-size:11px;min-width:30px;text-align:center;">1×</span><div style="width:1px;height:20px;background:rgba(100,140,255,0.2);margin:0 4px;"></div><button id="ss-close" style="${s}">✕ Close</button>`;
    // Date/time HUD
    const hud = document.createElement('div');
    hud.id = 'ss-hud';
    hud.style.cssText = 'position:absolute;top:12px;left:12px;color:rgba(180,200,255,0.8);font:12px monospace;line-height:1.6;pointer-events:none;';
    this.container.appendChild(hud);
    this.container.appendChild(ctrl);
    document.getElementById('canvas-container')!.appendChild(this.container);
    this.setupEvents();
  }

  private setupEvents() {
    document.getElementById('ss-close')!.addEventListener('click', () => this.hide());
    document.getElementById('ss-inner')!.addEventListener('click', () => { this.camDist = 3.5; });
    document.getElementById('ss-all')!.addEventListener('click', () => { this.camDist = 50; });
    document.getElementById('ss-rw')!.addEventListener('click', () => { if (this.time) { const s = this.time.getSpeed(); this.time.setSpeed(s <= -1 ? s * 2 : -1); this.updateHUD(); } });
    document.getElementById('ss-pause')!.addEventListener('click', () => { if (this.time) { this.time.setSpeed(this.time.getSpeed() === 0 ? 1 : 0); this.updateHUD(); } });
    document.getElementById('ss-ff')!.addEventListener('click', () => { if (this.time) { const s = this.time.getSpeed(); this.time.setSpeed(s >= 1 ? s * 2 : 1); this.updateHUD(); } });
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.camDist *= e.deltaY > 0 ? 1.1 : 0.9; this.camDist = Math.max(0.5, Math.min(120, this.camDist)); }, { passive: false });
    this.canvas.addEventListener('mousedown', (e) => { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; });
    this.canvas.addEventListener('mousemove', (e) => { if (!this.dragging) return; this.camPhi -= (e.clientX - this.lastX) * 0.005; this.camTheta = Math.max(5 * DEG2RAD, Math.min(85 * DEG2RAD, this.camTheta + (e.clientY - this.lastY) * 0.005)); this.lastX = e.clientX; this.lastY = e.clientY; });
    this.canvas.addEventListener('mouseup', () => this.dragging = false);
    this.canvas.addEventListener('mouseleave', () => this.dragging = false);
    let td = 0;
    this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); if (e.touches.length === 1) { this.dragging = true; this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY; } else if (e.touches.length === 2) td = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY); }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (e.touches.length === 1 && this.dragging) { this.camPhi -= (e.touches[0].clientX - this.lastX) * 0.005; this.camTheta = Math.max(5 * DEG2RAD, Math.min(85 * DEG2RAD, this.camTheta + (e.touches[0].clientY - this.lastY) * 0.005)); this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY; } else if (e.touches.length === 2) { const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY); this.camDist *= td / d; this.camDist = Math.max(0.5, Math.min(120, this.camDist)); td = d; } }, { passive: false });
    this.canvas.addEventListener('touchend', () => this.dragging = false);
  }

  private initGL() {
    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false })!;
    this.gl = gl;
    gl.clearColor(0.012, 0.016, 0.035, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    this.lineP = this.mkProg(V_LINE, F_LINE);
    this.planetP = this.mkProg(V_LINE, F_PLANET);
    this.starP = this.mkProg(V_STAR, F_STAR);
    for (let i = 0; i < this.planetNames.length; i++) {
      const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
      const vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, (ORBIT_SEGMENTS + 1) * 12, gl.DYNAMIC_DRAW);
      const loc = gl.getAttribLocation(this.lineP, 'a_position');
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.orbitVaos.push(vao); this.orbitVbos.push(vbo);
    }
    // Stars
    const ct = 2000; this.starCount = ct;
    const sd = new Float32Array(ct * 4);
    let seed = 99991; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < ct; i++) { const t = Math.acos(2 * rng() - 1), p = rng() * TWO_PI, r = 80 + rng() * 20; sd[i * 4] = r * Math.sin(t) * Math.cos(p); sd[i * 4 + 1] = r * Math.sin(t) * Math.sin(p); sd[i * 4 + 2] = r * Math.cos(t); sd[i * 4 + 3] = 0.3 + rng() * 0.7; }
    this.starVao = gl.createVertexArray()!; gl.bindVertexArray(this.starVao);
    const svbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, svbo); gl.bufferData(gl.ARRAY_BUFFER, sd, gl.STATIC_DRAW);
    const sp = gl.getAttribLocation(this.starP, 'a_position'); gl.enableVertexAttribArray(sp); gl.vertexAttribPointer(sp, 3, gl.FLOAT, false, 16, 0);
    const sb = gl.getAttribLocation(this.starP, 'a_brightness'); gl.enableVertexAttribArray(sb); gl.vertexAttribPointer(sb, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);
  }

  private mkProg(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const v = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(v, vs); gl.compileShader(v);
    if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(v)!);
    const f = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(f, fs); gl.compileShader(f);
    if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(f)!);
    const p = gl.createProgram()!; gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)!);
    return p;
  }

  private resize() { const d = window.devicePixelRatio || 1; this.canvas.width = this.canvas.clientWidth * d; this.canvas.height = this.canvas.clientHeight * d; this.gl.viewport(0, 0, this.canvas.width, this.canvas.height); }

  show(jd: number, time?: TimeSystem) { this.jd = jd; if (time) this.time = time; this.visible = true; this.container.style.display = 'block'; if (!this.gl) this.initGL(); this.resize(); window.addEventListener('resize', this.onResize); this.renderLoop(); }
  hide() { this.visible = false; this.container.style.display = 'none'; window.removeEventListener('resize', this.onResize); if (this.animId) cancelAnimationFrame(this.animId); this.labelContainer.innerHTML = ''; }
  isVisible() { return this.visible; }
  updateJD(jd: number) { this.jd = jd; }
  private onResize = () => { if (this.visible) this.resize(); };

  private updateHUD() {
    const hud = document.getElementById('ss-hud');
    const speedEl = document.getElementById('ss-speed');
    if (this.time) {
      if (hud) hud.textContent = this.time.getDateString();
      if (speedEl) speedEl.textContent = this.time.getSpeedLabel();
    }
  }
  private renderLoop = () => { if (!this.visible) return; this.draw(); this.animId = requestAnimationFrame(this.renderLoop); };

  private draw() {
    const gl = this.gl;
    if (this.time) { this.jd = this.time.getJD(); this.updateHUD(); }
    const T = jdToT(this.jd);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const eyeX = this.camDist * Math.sin(this.camTheta) * Math.cos(this.camPhi);
    const eyeY = this.camDist * Math.cos(this.camTheta);
    const eyeZ = this.camDist * Math.sin(this.camTheta) * Math.sin(this.camPhi);
    const view = mat4Look([eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
    const proj = mat4Persp(50 * DEG2RAD, w / h, 0.01, 250);
    const mvp = mat4Mul(proj, view);

    // Stars
    gl.depthMask(false);
    gl.useProgram(this.starP);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.starP, 'u_mvp'), false, mvp);
    gl.bindVertexArray(this.starVao); gl.drawArrays(gl.POINTS, 0, this.starCount); gl.bindVertexArray(null);
    gl.depthMask(true);

    // Orbits
    gl.useProgram(this.lineP);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineP, 'u_mvp'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(this.lineP, 'u_pointSize'), 1.0);
    for (let i = 0; i < this.planetNames.length; i++) {
      const pts = orbitPath3D(PLANETS[this.planetNames[i]], T);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.orbitVbos[i]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pts);
      const c = PLANET_COLORS[this.planetNames[i]];
      gl.uniform4f(gl.getUniformLocation(this.lineP, 'u_color'), c[0], c[1], c[2], 0.45);
      gl.bindVertexArray(this.orbitVaos[i]);
      gl.drawArrays(gl.LINE_STRIP, 0, ORBIT_SEGMENTS + 1);
    }
    gl.bindVertexArray(null);

    // Planets as points (draw one by one with different sizes)
    gl.useProgram(this.planetP);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.planetP, 'u_mvp'), false, mvp);

    // Sun
    const sunBuf = new Float32Array([0, 0, 0]);
    const tmpVao = gl.createVertexArray()!; gl.bindVertexArray(tmpVao);
    const tmpVbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, tmpVbo);
    gl.bufferData(gl.ARRAY_BUFFER, sunBuf, gl.DYNAMIC_DRAW);
    const aloc = gl.getAttribLocation(this.planetP, 'a_position');
    gl.enableVertexAttribArray(aloc); gl.vertexAttribPointer(aloc, 3, gl.FLOAT, false, 0, 0);
    gl.uniform1f(gl.getUniformLocation(this.planetP, 'u_pointSize'), PLANET_PT_SIZE.Sun);
    const sc = PLANET_COLORS.Sun;
    gl.uniform4f(gl.getUniformLocation(this.planetP, 'u_color'), sc[0], sc[1], sc[2], 1.0);
    gl.drawArrays(gl.POINTS, 0, 1);

    // Labels HTML
    let labels = '';
    const sunS = proj3D([0, 0, 0], mvp, w, h);
    if (sunS) labels += `<span style="position:absolute;left:${sunS[0] + 12}px;top:${sunS[1] - 6}px;color:rgb(255,224,48);">Sun</span>`;

    // Each planet
    for (const name of this.planetNames) {
      const pos = helio3D(PLANETS[name], T);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(pos));
      const c = PLANET_COLORS[name];
      gl.uniform1f(gl.getUniformLocation(this.planetP, 'u_pointSize'), PLANET_PT_SIZE[name] || 6);
      gl.uniform4f(gl.getUniformLocation(this.planetP, 'u_color'), c[0], c[1], c[2], 1.0);
      gl.drawArrays(gl.POINTS, 0, 1);
      const sp = proj3D(pos, mvp, w, h);
      if (sp) labels += `<span style="position:absolute;left:${sp[0] + 10}px;top:${sp[1] - 6}px;color:rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)});">${name}</span>`;
    }

    gl.deleteBuffer(tmpVbo);
    gl.deleteVertexArray(tmpVao);
    gl.bindVertexArray(null);

    this.labelContainer.innerHTML = labels;
  }
}
