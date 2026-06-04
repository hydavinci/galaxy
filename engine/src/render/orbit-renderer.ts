/**
 * Renders planetary orbit paths projected onto the celestial sphere.
 * Each planet's orbit is shown as a colored ellipse on the sky.
 */
import lineVert from './shaders/line.vert.glsl';
import lineFrag from './shaders/line.frag.glsl';
import { jdToT } from '../astro/coordinates';

const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

interface OrbitalElements {
  L0: number; L1: number;
  a: number;
  e0: number; e1: number;
  I0: number; I1: number;
  w0: number; w1: number;
  O0: number; O1: number;
}

const PLANETS: Record<string, OrbitalElements> = {
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
  Mercury: [0.7, 0.7, 0.7],
  Venus:   [1.0, 1.0, 0.6],
  Mars:    [1.0, 0.4, 0.2],
  Jupiter: [1.0, 0.85, 0.5],
  Saturn:  [1.0, 0.8, 0.4],
  Uranus:  [0.5, 1.0, 1.0],
  Neptune: [0.4, 0.6, 1.0],
};

const ORBIT_SEGMENTS = 180;

function normalizeAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

function solveKepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 10; i++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-8) break;
  }
  return E;
}

function helioEcliptic(el: OrbitalElements, T: number): { x: number; y: number; z: number } {
  const L = (el.L0 + el.L1 * T) * DEG2RAD;
  const e = el.e0 + el.e1 * T;
  const I = (el.I0 + el.I1 * T) * DEG2RAD;
  const w = (el.w0 + el.w1 * T) * DEG2RAD;
  const O = (el.O0 + el.O1 * T) * DEG2RAD;
  const a = el.a;

  const omega = w - O;
  const M = normalizeAngle(L - w);
  const E = solveKepler(M, e);

  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cosO = Math.cos(O), sinO = Math.sin(O);
  const cosI = Math.cos(I), sinI = Math.sin(I);
  const cosW = Math.cos(omega), sinW = Math.sin(omega);

  const x = (cosO * cosW - sinO * sinW * cosI) * xp + (-cosO * sinW - sinO * cosW * cosI) * yp;
  const y = (sinO * cosW + cosO * sinW * cosI) * xp + (-sinO * sinW + cosO * cosW * cosI) * yp;
  const z = (sinW * sinI) * xp + (cosW * sinI) * yp;

  return { x, y, z };
}

/**
 * Compute orbit points for a planet as geocentric equatorial unit vectors.
 * We sample the planet's true anomaly around its orbit, compute geocentric
 * direction, and project onto the celestial sphere.
 */
function computeOrbitPoints(planetName: string, T: number): Float32Array {
  const el = PLANETS[planetName];
  const earthEl = PLANETS.Earth;

  // Earth position at current time
  const earthPos = helioEcliptic(earthEl, T);

  const eps = 23.4393 * DEG2RAD;
  const cosEps = Math.cos(eps), sinEps = Math.sin(eps);

  // For the orbit, we sample the planet at many points along its orbit
  // by varying its mean anomaly while keeping other elements at current epoch
  const e = el.e0 + el.e1 * T;
  const I = (el.I0 + el.I1 * T) * DEG2RAD;
  const w = (el.w0 + el.w1 * T) * DEG2RAD;
  const O = (el.O0 + el.O1 * T) * DEG2RAD;
  const a = el.a;
  const omega = w - O;

  const cosO = Math.cos(O), sinO = Math.sin(O);
  const cosI = Math.cos(I), sinI = Math.sin(I);
  const cosW = Math.cos(omega), sinW = Math.sin(omega);

  const points = new Float32Array(ORBIT_SEGMENTS * 3);

  for (let i = 0; i < ORBIT_SEGMENTS; i++) {
    const M = (i / ORBIT_SEGMENTS) * TWO_PI;
    const E = solveKepler(M, e);

    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

    // Heliocentric ecliptic
    const hx = (cosO * cosW - sinO * sinW * cosI) * xp + (-cosO * sinW - sinO * cosW * cosI) * yp;
    const hy = (sinO * cosW + cosO * sinW * cosI) * xp + (-sinO * sinW + cosO * cosW * cosI) * yp;
    const hz = (sinW * sinI) * xp + (cosW * sinI) * yp;

    // Geocentric ecliptic
    const dx = hx - earthPos.x;
    const dy = hy - earthPos.y;
    const dz = hz - earthPos.z;

    // Ecliptic to equatorial
    const eqX = dx;
    const eqY = dy * cosEps - dz * sinEps;
    const eqZ = dy * sinEps + dz * cosEps;

    // Normalize to unit sphere
    const r = Math.sqrt(eqX * eqX + eqY * eqY + eqZ * eqZ);

    // Engine coordinate system: (cos(dec)*cos(ra), sin(dec), cos(dec)*sin(ra))
    // From equatorial cartesian (x toward vernal equinox, z toward NCP, y = z×x):
    // Actually the ecliptic->equatorial gives us:
    //   eqX = toward vernal equinox (RA=0, Dec=0)
    //   eqY = toward RA=6h, Dec=0
    //   eqZ = toward NCP
    // Engine expects: x=cos(dec)*cos(ra), y=sin(dec), z=cos(dec)*sin(ra)
    // So: engine.x = eqX/r, engine.y = eqZ/r, engine.z = eqY/r
    points[i * 3]     = eqX / r;
    points[i * 3 + 1] = eqZ / r;
    points[i * 3 + 2] = eqY / r;
  }

  return points;
}

export class OrbitRenderer {
  private program!: WebGLProgram;
  private vaos: WebGLVertexArrayObject[] = [];
  private vbos: WebGLBuffer[] = [];
  private planetNames: string[] = [];
  private locs: Record<string, WebGLUniformLocation> = {};
  private lastT = -999;

  constructor(private gl: WebGL2RenderingContext) {}

  init() {
    const gl = this.gl;
    this.program = this.createProgram(lineVert, lineFrag);
    gl.useProgram(this.program);
    this.locs['u_viewMatrix'] = gl.getUniformLocation(this.program, 'u_viewMatrix')!;
    this.locs['u_projMatrix'] = gl.getUniformLocation(this.program, 'u_projMatrix')!;
    this.locs['u_color'] = gl.getUniformLocation(this.program, 'u_color')!;

    // Create VAO/VBO for each planet
    this.planetNames = Object.keys(PLANET_COLORS);
    for (let p = 0; p < this.planetNames.length; p++) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, ORBIT_SEGMENTS * 3 * 4, gl.DYNAMIC_DRAW);
      const aPos = gl.getAttribLocation(this.program, 'a_position');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.vaos.push(vao);
      this.vbos.push(vbo);
    }
  }

  /**
   * Update orbit geometry when time changes significantly
   */
  update(jd: number) {
    const T = jdToT(jd);
    // Only recompute if time changed by >0.1 century (~36 days)
    if (Math.abs(T - this.lastT) < 0.001) return;
    this.lastT = T;

    const gl = this.gl;
    for (let p = 0; p < this.planetNames.length; p++) {
      const points = computeOrbitPoints(this.planetNames[p], T);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbos[p]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, points);
    }
  }

  render(view: Float32Array, proj: Float32Array) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locs['u_viewMatrix'], false, view);
    gl.uniformMatrix4fv(this.locs['u_projMatrix'], false, proj);

    for (let p = 0; p < this.planetNames.length; p++) {
      const c = PLANET_COLORS[this.planetNames[p]];
      gl.uniform4f(this.locs['u_color'], c[0], c[1], c[2], 0.6);
      gl.bindVertexArray(this.vaos[p]);
      gl.drawArrays(gl.LINE_LOOP, 0, ORBIT_SEGMENTS);
    }
    gl.bindVertexArray(null);
  }

  private createProgram(vsrc: string, fsrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS))
      throw new Error('Vertex shader: ' + gl.getShaderInfoLog(vs));
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS))
      throw new Error('Fragment shader: ' + gl.getShaderInfoLog(fs));
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    return prog;
  }
}
