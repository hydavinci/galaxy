import { PlanetData } from '../astro/planets';
import sphereVert from './shaders/planet-sphere.vert.glsl';
import sphereFrag from './shaders/planet-sphere.frag.glsl';

// Texture file mapping
const PLANET_TEXTURES: Record<string, string> = {
  Moon: 'textures/2k_moon.jpg',
  Sun: 'textures/2k_sun.jpg',
  Mercury: 'textures/2k_mercury.jpg',
  Venus: 'textures/2k_venus_surface.jpg',
  Earth: 'textures/2k_earth_daymap.jpg',
  Mars: 'textures/2k_mars.jpg',
  Jupiter: 'textures/2k_jupiter.jpg',
  Saturn: 'textures/2k_saturn.jpg',
  Uranus: 'textures/2k_uranus.jpg',
  Neptune: 'textures/2k_neptune.jpg',
};

interface SphereGeometry {
  vao: WebGLVertexArrayObject;
  indexCount: number;
}

export class PlanetSphereRenderer {
  private program!: WebGLProgram;
  private sphere!: SphereGeometry;
  private textures: Map<string, WebGLTexture> = new Map();
  private texturesLoading: Set<string> = new Set();
  private locs: Record<string, WebGLUniformLocation> = {};

  constructor(private gl: WebGL2RenderingContext) {}

  init() {
    const gl = this.gl;
    this.program = this.createProgram(sphereVert, sphereFrag);
    this.locs = {
      u_mvp: gl.getUniformLocation(this.program, 'u_mvp')!,
      u_model: gl.getUniformLocation(this.program, 'u_model')!,
      u_texture: gl.getUniformLocation(this.program, 'u_texture')!,
      u_sunDir: gl.getUniformLocation(this.program, 'u_sunDir')!,
      u_ambient: gl.getUniformLocation(this.program, 'u_ambient')!,
      u_opacity: gl.getUniformLocation(this.program, 'u_opacity')!,
    };
    this.sphere = this.createUVSphere(32, 16);
    this.preloadTextures();
  }

  private preloadTextures() {
    for (const [name, path] of Object.entries(PLANET_TEXTURES)) {
      this.loadTexture(name, path);
    }
  }

  private loadTexture(name: string, path: string) {
    if (this.textures.has(name) || this.texturesLoading.has(name)) return;
    this.texturesLoading.add(name);
    const gl = this.gl;
    const tex = gl.createTexture()!;
    // Placeholder 1x1 pixel
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.set(name, tex);
      this.texturesLoading.delete(name);
    };
    img.onerror = () => {
      this.texturesLoading.delete(name);
    };
    img.src = path;
    // Store placeholder immediately so we can render something
    this.textures.set(name, tex);
  }

  /**
   * Render a planet as a textured sphere.
   * @param planet - planet data
   * @param view - 4x4 view matrix
   * @param proj - 4x4 projection matrix
   * @param fov - current field of view in radians
   * @param sunRA - Sun's RA in radians
   * @param sunDec - Sun's Dec in radians
   */
  renderPlanet(planet: PlanetData, view: Float32Array, proj: Float32Array, fov: number, sunRA: number, sunDec: number, opacity: number = 1.0, angularSize: number = 0.003) {
    const gl = this.gl;
    const tex = this.textures.get(planet.name);
    if (!tex) return;

    // Planet direction on unit sphere
    const ra = planet.ra, dec = planet.dec;
    const px = Math.cos(dec) * Math.cos(ra);
    const py = Math.sin(dec);
    const pz = Math.cos(dec) * Math.sin(ra);

    // Sun direction (for lighting)
    const sx = Math.cos(sunDec) * Math.cos(sunRA);
    const sy = Math.sin(sunDec);
    const sz = Math.cos(sunDec) * Math.sin(sunRA);

    // Sun direction relative to planet (in world space, both on unit sphere)
    // For lighting, we want the direction FROM planet TO sun
    const toSunX = sx - px, toSunY = sy - py, toSunZ = sz - pz;
    const toSunLen = Math.sqrt(toSunX * toSunX + toSunY * toSunY + toSunZ * toSunZ) || 1;

    // Sphere radius = angular size (radians) on the unit sphere
    const sphereRadius = angularSize / 2;

    // Model matrix: translate to planet direction, scale to sphere radius
    // Place sphere at distance 1.0 in planet direction (on unit sphere)
    const model = new Float32Array(16);
    model[0] = sphereRadius; model[5] = sphereRadius; model[10] = sphereRadius;
    model[12] = px; model[13] = py; model[14] = pz;
    model[15] = 1;

    // MVP = proj * view * model
    const mv = this.mat4Mul(view, model);
    const mvp = this.mat4Mul(proj, mv);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locs.u_mvp, false, mvp);
    gl.uniformMatrix4fv(this.locs.u_model, false, model);
    gl.uniform3f(this.locs.u_sunDir, toSunX / toSunLen, toSunY / toSunLen, toSunZ / toSunLen);
    // Sun is self-illuminated
    const ambient = planet.name === 'Sun' ? 1.0 : 0.15;
    gl.uniform1f(this.locs.u_ambient, ambient);
    gl.uniform1f(this.locs.u_opacity, opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.locs.u_texture, 0);

    gl.bindVertexArray(this.sphere.vao);
    gl.drawElements(gl.TRIANGLES, this.sphere.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  hasTexture(name: string): boolean {
    return PLANET_TEXTURES[name] !== undefined;
  }

  textureReady(name: string): boolean {
    return this.textures.has(name);
  }

  private createUVSphere(segments: number, rings: number): SphereGeometry {
    const gl = this.gl;
    const positions: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (let y = 0; y <= rings; y++) {
      const phi = (y / rings) * Math.PI;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      for (let x = 0; x <= segments; x++) {
        const theta = (x / segments) * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        const nx = sinPhi * cosTheta;
        const ny = cosPhi;
        const nz = sinPhi * sinTheta;

        positions.push(nx, ny, nz);
        normals.push(nx, ny, nz);
        uvs.push(x / segments, y / rings);
      }
    }

    for (let y = 0; y < rings; y++) {
      for (let x = 0; x < segments; x++) {
        const a = y * (segments + 1) + x;
        const b = a + segments + 1;
        indices.push(a, b, a + 1);
        indices.push(b, b + 1, a + 1);
      }
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    // Position
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    // UV
    const uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    const aUV = gl.getAttribLocation(this.program, 'a_uv');
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

    // Normal
    const normBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    const aNorm = gl.getAttribLocation(this.program, 'a_normal');
    gl.enableVertexAttribArray(aNorm);
    gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, 0, 0);

    // Index
    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    return { vao, indexCount: indices.length };
  }

  private mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        out[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
      }
    }
    return out;
  }

  private createProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const v = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(v, vs); gl.compileShader(v);
    if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) {
      console.error('Sphere vert shader:', gl.getShaderInfoLog(v));
    }
    const f = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(f, fs); gl.compileShader(f);
    if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) {
      console.error('Sphere frag shader:', gl.getShaderInfoLog(f));
    }
    const p = gl.createProgram()!;
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Sphere program:', gl.getProgramInfoLog(p));
    }
    return p;
  }
}
