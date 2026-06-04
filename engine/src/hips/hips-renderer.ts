/**
 * HiPS WebGL renderer using Stellarium's approach:
 * 1. healpix_get_mat3: affine UV → HEALPix planar coords
 * 2. healpix_xy2vec: planar coords → unit sphere direction
 */

import { HipsTileManager, HipsConfig, HipsTile } from './tile-manager';
import { chooseOrder, getVisibleTiles } from './visibility';
import { order2nside } from './healpix';

const TILE_GRID_N = 12; // subdivide each tile into 12x12 quads

const VERT_SRC = `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_uv;
uniform mat4 u_viewMatrix;
uniform mat4 u_projMatrix;
out vec2 v_uv;

void main() {
  vec4 viewPos = u_viewMatrix * vec4(a_position, 0.0);
  gl_Position = u_projMatrix * vec4(viewPos.xyz, 1.0);
  v_uv = a_uv;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform vec3 u_texTransform; // x=offsetU, y=offsetV, z=scale
out vec4 fragColor;

void main() {
  vec2 uv = v_uv * u_texTransform.z + u_texTransform.xy;
  vec3 color = texture(u_texture, uv).rgb;
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(color * u_opacity, lum * u_opacity);
}
`;

// HEALPix face positions in the planar projection
const FACES: [number, number][] = [
  [1, 0], [3, 0], [5, 0], [7, 0],
  [0, -1], [2, -1], [4, -1], [6, -1],
  [1, -2], [3, -2], [5, -2], [7, -2],
];

// Galactic to Equatorial rotation (column-major for mat4 multiply)
const GAL_TO_EQ = new Float32Array([
  -0.0548756, -0.8734371, -0.4838350, 0,
   0.4941094, -0.4448296,  0.7469823, 0,
  -0.8676661, -0.1980764,  0.4559838, 0,
   0, 0, 0, 1
]);

export class HipsRenderer {
  private gl: WebGL2RenderingContext;
  private tileManager: HipsTileManager;
  private program!: WebGLProgram;
  private locs: Record<string, WebGLUniformLocation> = {};
  private attribs: Record<string, number> = {};
  private meshCache: Map<string, { vao: WebGLVertexArrayObject; indexCount: number }> = new Map();
  private opacity = 1.0;

  constructor(gl: WebGL2RenderingContext, config: HipsConfig) {
    this.gl = gl;
    this.tileManager = new HipsTileManager(gl, config);
  }

  init() {
    const gl = this.gl;
    this.program = this.createProgram(VERT_SRC, FRAG_SRC);
    gl.useProgram(this.program);
    this.locs['u_viewMatrix'] = gl.getUniformLocation(this.program, 'u_viewMatrix')!;
    this.locs['u_projMatrix'] = gl.getUniformLocation(this.program, 'u_projMatrix')!;
    this.locs['u_texture'] = gl.getUniformLocation(this.program, 'u_texture')!;
    this.locs['u_opacity'] = gl.getUniformLocation(this.program, 'u_opacity')!;
    this.locs['u_texTransform'] = gl.getUniformLocation(this.program, 'u_texTransform')!;
    this.attribs['a_position'] = gl.getAttribLocation(this.program, 'a_position');
    this.attribs['a_uv'] = gl.getAttribLocation(this.program, 'a_uv');

    // Preload order 0 (12 tiles) as base fallback
    for (let i = 0; i < 12; i++) {
      this.tileManager.requestTile(0, i);
    }
  }

  setOpacity(o: number) { this.opacity = o; }

  render(view: Float32Array, proj: Float32Array, fov: number, viewport: [number, number]) {
    const gl = this.gl;
    const config = this.tileManager.getConfig();
    let order = chooseOrder(fov, viewport[1], config.tileSize, config.maxOrder);

    // Ensure we have at least some tiles loaded at this order or below
    // If the chosen order has no loaded tiles, fall back to order 0
    if (order > 0 && !this.tileManager.hasLoadedTilesAtOrder(order)) {
      order = 0;
    }

    const visibleTiles = getVisibleTiles(order, view, proj, fov);

    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(this.locs['u_viewMatrix'], false, view);
    gl.uniformMatrix4fv(this.locs['u_projMatrix'], false, proj);
    gl.uniform1f(this.locs['u_opacity'], this.opacity);
    gl.uniform1i(this.locs['u_texture'], 0);
    gl.activeTexture(gl.TEXTURE0);

    this.renderedThisFrame.clear();

    for (const { order: tileOrder, pix } of visibleTiles) {
      this.renderTile(tileOrder, pix);
    }
    gl.enable(gl.DEPTH_TEST);
  }

  private renderedThisFrame = new Set<string>();

  private renderTile(order: number, pix: number) {
    const gl = this.gl;
    const tile = this.tileManager.getTileOrAncestor(order, pix);
    if (!tile || !tile.texture) return;

    // Render using tile's own geometry to avoid UV mismatch
    const key = `${tile.order}/${tile.pix}`;
    if (this.renderedThisFrame.has(key)) return;
    this.renderedThisFrame.add(key);

    gl.bindTexture(gl.TEXTURE_2D, tile.texture);
    gl.uniform3f(this.locs['u_texTransform'], 0, 0, 1);

    const mesh = this.getOrBuildMesh(tile.order, tile.pix);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  private getOrBuildMesh(order: number, pix: number) {
    const uvOffX = 0, uvOffY = 0, uvScale = 1;
    const key = `${order}/${pix}`;
    const cached = this.meshCache.get(key);
    if (cached) return cached;

    const gl = this.gl;
    const config = this.tileManager.getConfig();
    const isGalactic = config.frame === 'galactic';
    const n = TILE_GRID_N;
    const nside = order2nside(order);
    const nside2 = nside * nside;
    const face = Math.floor(pix / nside2);
    const remainder = pix % nside2;
    const ix = this.compress(remainder);
    const iy = this.compress(remainder >> 1);

    // Stellarium's affine: mat * [u, v, 1] → HEALPix planar (x, y)
    const scale = Math.PI / 4 / nside;
    const originX = (FACES[face][0] + (ix - iy) / nside) * Math.PI / 4;
    const originY = (FACES[face][1] + (ix + iy) / nside) * Math.PI / 4;
    // From Stellarium healpix_get_mat3 (NO swap on geometry):
    // mat[0] = [+scale, +scale, 0]  → column for u
    // mat[1] = [-scale, +scale, 0]  → column for v
    // origin = [(face_x + (ix-iy)/nside)*pi/4, (face_y + (ix+iy)/nside)*pi/4]
    // Result: hpx = origin_x + u*scale + v*(-scale)
    //         hpy = origin_y + u*scale + v*(+scale)
    const col0x = +scale; // du → dx
    const col0y = +scale; // du → dy
    const col1x = -scale; // dv → dx
    const col1y = +scale; // dv → dy

    const vertCount = (n + 1) * (n + 1);
    const interleaved = new Float32Array(vertCount * 5);
    let vi = 0;

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const v = j / n;

        const hpx = originX + u * col0x + v * col1x;
        const hpy = originY + u * col0y + v * col1y;

        let dir = this.healpixXy2Vec(hpx, hpy);

        if (isGalactic) {
          const [gx, gy, gz] = dir;
          dir = [
            GAL_TO_EQ[0] * gx + GAL_TO_EQ[4] * gy + GAL_TO_EQ[8] * gz,
            GAL_TO_EQ[1] * gx + GAL_TO_EQ[5] * gy + GAL_TO_EQ[9] * gz,
            GAL_TO_EQ[2] * gx + GAL_TO_EQ[6] * gy + GAL_TO_EQ[10] * gz,
          ];
        }

        interleaved[vi++] = dir[0];
        interleaved[vi++] = dir[1];
        interleaved[vi++] = dir[2];
        // Texture UV (with Stellarium's uv_swap: swap u and v)
        interleaved[vi++] = uvOffX + v * uvScale;
        interleaved[vi++] = uvOffY + u * uvScale;
      }
    }

    const indices: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p0 = j * (n + 1) + i;
        const p1 = p0 + 1;
        const p2 = (j + 1) * (n + 1) + i;
        const p3 = p2 + 1;
        indices.push(p0, p2, p1);
        indices.push(p1, p2, p3);
      }
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.attribs['a_position']);
    gl.vertexAttribPointer(this.attribs['a_position'], 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.attribs['a_uv']);
    gl.vertexAttribPointer(this.attribs['a_uv'], 2, gl.FLOAT, false, 20, 12);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const result = { vao, indexCount: indices.length };

    if (this.meshCache.size > 400) {
      const first = this.meshCache.keys().next().value!;
      const old = this.meshCache.get(first)!;
      gl.deleteVertexArray(old.vao);
      this.meshCache.delete(first);
    }
    this.meshCache.set(key, result);
    return result;
  }

  /**
   * Stellarium's healpix_xy2vec: HEALPix planar (x,y) → unit vector.
   * Returns [x, y, z] where z is toward north pole.
   * We convert to our y-up convention inline.
   */
  private healpixXy2Vec(x: number, y: number): [number, number, number] {
    let z: number, phi: number;

    if (Math.abs(y) > Math.PI / 4) {
      // Polar region
      const sigma = 2 - Math.abs(y * 4) / Math.PI;
      z = (y > 0 ? 1 : -1) * (1 - sigma * sigma / 3);
      const xc = -Math.PI + (2 * Math.floor((x + Math.PI) * 4 / (2 * Math.PI)) + 1) * Math.PI / 4;
      phi = sigma !== 0 ? (xc + (x - xc) / sigma) : x;
    } else {
      // Equatorial region
      phi = x;
      z = y * 8 / (Math.PI * 3);
    }

    const stheta = Math.sqrt(Math.max(0, (1 - z) * (1 + z)));
    // Stellarium: out[0]=stheta*cos(phi), out[1]=stheta*sin(phi), out[2]=z
    // Our engine: y-up, so map z→y, and (x,y_stel)→(x,z)
    return [stheta * Math.cos(phi), z, stheta * Math.sin(phi)];
  }

  private compress(v: number): number {
    v &= 0x55555555;
    v = (v | (v >> 1)) & 0x33333333;
    v = (v | (v >> 2)) & 0x0f0f0f0f;
    v = (v | (v >> 4)) & 0x00ff00ff;
    v = (v | (v >> 8)) & 0x0000ffff;
    return v;
  }

  private createProgram(vsrc: string, fsrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS))
      throw new Error('HiPS VS: ' + gl.getShaderInfoLog(vs));
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS))
      throw new Error('HiPS FS: ' + gl.getShaderInfoLog(fs));
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('HiPS Link: ' + gl.getProgramInfoLog(prog));
    return prog;
  }
}
