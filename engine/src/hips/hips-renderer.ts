/** HiPS renderer: Y-up J2000 geometry, target LOD with ancestor sub-UV fallback. */
import { HipsTileManager, type HipsConfig, type HipsTileStats } from './tile-manager';
import { chooseOrder, getVisibleTiles, type VisibleTile } from './visibility';
import { ancestorTextureTransform, galacticToEquatorial, order2nside, pix2vecNested } from './healpix';
import { REFRACTION_CULL_MARGIN_RAD, REFRACTION_GLSL, refractHorizonDirection } from './refraction';

const TILE_GRID_N = 12;

const VERT_SRC = `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_uv;
uniform mat4 u_viewMatrix;
uniform mat4 u_projMatrix;
uniform mat4 u_equatorialToHorizontal;
uniform mat4 u_horizontalView;
uniform float u_refraction;
out vec2 v_uv;
${REFRACTION_GLSL}

void main() {
  vec4 viewPos = u_viewMatrix * vec4(a_position, 0.0);
  if (u_refraction > 0.5) {
    vec3 horizon = normalize((u_equatorialToHorizontal * vec4(a_position, 0.0)).xyz);
    viewPos = u_horizontalView * vec4(refractDirection(horizon, 1.0), 0.0);
  }
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


interface TileMesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  indexCount: number;
}

export interface HipsStats extends HipsTileStats {
  targetOrder: number;
  visible: number;
  drawn: number;
  fallbackDrawn: number;
  meshes: number;
  maxMeshTiles: number;
  visibilityBuilds: number;
  meshBuilds: number;
}

/** Pure CPU construction, using the same continuous HEALPix mapping as culling. */
export function buildTileMeshData(order: number, pix: number, frame: HipsConfig['frame'], n = TILE_GRID_N) {
  const vertices = new Float32Array((n + 1) ** 2 * 5);
  let vi = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n;
    let dir = pix2vecNested(order2nside(order), pix, u, v);
    if (frame === 'galactic') dir = galacticToEquatorial(dir);
    vertices.set([dir[0], dir[1], dir[2], v, u], vi);
    vi += 5;
  }
  const indices = new Uint16Array(n * n * 6);
  let ii = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p0 = j * (n + 1) + i, p1 = p0 + 1;
    const p2 = p0 + n + 1, p3 = p2 + 1;
    indices.set([p0, p2, p1, p1, p2, p3], ii);
    ii += 6;
  }
  return { vertices, indices };
}

export interface HipsProjectionOptions {
  equatorialToHorizontal: Float32Array;
  horizontalView: Float32Array;
  refraction: boolean;
}
/** CPU mirror of the vertex projection, for alignment checks (not GPU proof). */
export function hipsViewDirection(direction: readonly number[], view: Float32Array, options?: HipsProjectionOptions): [number, number, number] {
  const apply = (m: Float32Array, p: readonly number[]): [number, number, number] =>
    [m[0]*p[0]+m[4]*p[1]+m[8]*p[2], m[1]*p[0]+m[5]*p[1]+m[9]*p[2], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]];
  if (!options?.refraction) return apply(view, direction);
  const h = apply(options.equatorialToHorizontal, direction), n = Math.hypot(...h);
  return apply(options.horizontalView, refractHorizonDirection(h.map(v => v/n)));
}

export class HipsRenderer {
  private tileManager: HipsTileManager;
  private program: WebGLProgram | null = null;
  private locs: Record<string, WebGLUniformLocation | null> = {};
  private attribs: Record<string, number> = {};
  private meshCache = new Map<string, TileMesh>();
  private opacity = 1;
  private targetOrder = 0;
  private drawn = 0;
  private fallbackDrawn = 0;
  private visible = 0;
  private disposed = false;
  private maxMeshes: number;
  private maxVisible: number;
  private gridSegments = TILE_GRID_N;
  private visibilityBuilds = 0;
  private meshBuilds = 0;
  private visibilityKey: number[] = [];
  private visibleLeaves: VisibleTile[] = [];
  private protectedMeshes = new Set<string>();

  constructor(private gl: WebGL2RenderingContext, private config: HipsConfig) {
    this.tileManager = new HipsTileManager(gl, config);
    this.maxMeshes = this.limit(config.maxMeshTiles, 192);
    this.maxVisible = Math.min(this.maxMeshes, this.limit(config.maxVisibleTiles, 128));
  }

  private limit(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? Math.max(12, Math.min(512, Math.floor(value!))) : fallback;
  }

  init(): void {
    if (this.disposed || this.program) return;
    const gl = this.gl;
    this.program = this.createProgram(VERT_SRC, FRAG_SRC);
    for (const uniform of ['u_viewMatrix', 'u_projMatrix', 'u_texture', 'u_opacity', 'u_texTransform', 'u_refraction', 'u_equatorialToHorizontal', 'u_horizontalView'])
      this.locs[uniform] = gl.getUniformLocation(this.program, uniform);
    for (const attribute of ['a_position', 'a_uv'])
      this.attribs[attribute] = gl.getAttribLocation(this.program, attribute);
    // First render requests visible ancestors (or all 12 roots in complete-base mode).
  }

  setOpacity(opacity: number): void { this.opacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0; }
  getTileCount(): number { return this.tileManager.getTileCount(); }
  getMaxCacheTiles(): number { return this.tileManager.getMaxCacheTiles(); }
  getStats(): HipsStats {
    return { ...this.tileManager.getStats(), targetOrder: this.targetOrder,
      visible: this.visible, drawn: this.drawn, fallbackDrawn: this.fallbackDrawn,
      meshes: this.meshCache.size, maxMeshTiles: this.maxMeshes,
      visibilityBuilds: this.visibilityBuilds, meshBuilds: this.meshBuilds };
  }

  render(view: Float32Array, proj: Float32Array, fov: number, viewport: [number, number], options?: HipsProjectionOptions): void {
    this.drawn = this.fallbackDrawn = 0;
    if (this.disposed || !this.program) return;
    this.targetOrder = chooseOrder(fov, viewport[1], this.config.tileSize, this.config.maxOrder);
    // Curved differential refraction needs finer tessellation at narrow FOV;
    // this is cached per quality level, never rebuilt every frame.
    this.gridSegments = options?.refraction ? (fov < 5 * Math.PI / 180 ? 64 : fov < 25 * Math.PI / 180 ? 24 : TILE_GRID_N) : TILE_GRID_N;
    // Exact-value memoization only. Moving views still recull this very frame;
    // matrix uniforms below always consume the current caller's arrays.
    const margin = options?.refraction ? REFRACTION_CULL_MARGIN_RAD : 0;
    const key = [this.targetOrder, fov, margin, this.config.frame === 'galactic' ? 1 : 0, ...view, ...proj];
    if (key.length !== this.visibilityKey.length || key.some((value, i) => value !== this.visibilityKey[i])) {
      this.visibleLeaves = getVisibleTiles(this.targetOrder, view, proj, fov, this.config.frame, this.maxVisible, margin);
      this.visibilityKey = key;
      this.visibilityBuilds++;
    }
    const leaves = this.visibleLeaves;
    this.visible = leaves.length;
    this.tileManager.updateVisibleTiles(leaves);
    // Never expose a partially loaded sky. Once ready, pinned roots guarantee a
    // fallback for every leaf, including after view, LOD and DPR changes.
    if (this.config.requireCompleteBase && !this.tileManager.getStats().baseReady) return;

    // Protect the entire current working set *before* the first allocation.
    // LRU touching during the draw alone can evict a later visible leaf, causing
    // a cascading rebuild after a pan when cache capacity equals draw budget.
    this.protectedMeshes.clear();
    for (const { order, pix } of leaves) this.protectedMeshes.add(`${order}/${pix}/${this.gridSegments}`);

    const gl = this.gl;
    const state = {
      depth: gl.isEnabled(gl.DEPTH_TEST), cull: gl.isEnabled(gl.CULL_FACE),
      depthMask: gl.getParameter(gl.DEPTH_WRITEMASK), program: gl.getParameter(gl.CURRENT_PROGRAM),
      vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), buffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
    };
    gl.activeTexture(gl.TEXTURE0);
    const binding = gl.getParameter(gl.TEXTURE_BINDING_2D);
    try {
      gl.useProgram(this.program);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      gl.uniformMatrix4fv(this.locs.u_viewMatrix, false, view);
      gl.uniformMatrix4fv(this.locs.u_projMatrix, false, proj);
      gl.uniform1f(this.locs.u_opacity, this.opacity);
      gl.uniform1i(this.locs.u_texture, 0);
      gl.uniform1f(this.locs.u_refraction, options?.refraction ? 1 : 0);
      if (options?.refraction) {
        gl.uniformMatrix4fv(this.locs.u_equatorialToHorizontal, false, options.equatorialToHorizontal);
        gl.uniformMatrix4fv(this.locs.u_horizontalView, false, options.horizontalView);
      }
      for (const { order, pix } of leaves) {
        const tile = this.tileManager.getTileOrAncestor(order, pix, false);
        if (!tile?.texture) continue;
        // Geometry always belongs to this non-overlapping leaf. Never redraw an
        // entire parent beneath a loaded child (which brightens additive passes).
        gl.bindTexture(gl.TEXTURE_2D, tile.texture);
        gl.uniform3f(this.locs.u_texTransform, ...ancestorTextureTransform(order, pix, tile.order));
        const mesh = this.getOrBuildMesh(order, pix);
        gl.bindVertexArray(mesh.vao);
        gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
        this.drawn++;
        if (tile.order < order) this.fallbackDrawn++;
      }
    } finally {
      if (state.depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      if (state.cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
      gl.depthMask(state.depthMask);
      gl.bindVertexArray(state.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
      gl.bindTexture(gl.TEXTURE_2D, binding);
      gl.activeTexture(state.activeTexture);
      gl.useProgram(state.program);
    }
  }

  private deleteMesh(mesh: TileMesh): void {
    this.gl.deleteVertexArray(mesh.vao);
    this.gl.deleteBuffer(mesh.vbo);
    this.gl.deleteBuffer(mesh.ibo);
  }

  private getOrBuildMesh(order: number, pix: number): TileMesh {
    const key = `${order}/${pix}/${this.gridSegments}`;
    const cached = this.meshCache.get(key);
    if (cached) {
      this.meshCache.delete(key);
      this.meshCache.set(key, cached);
      return cached;
    }
    const gl = this.gl;
    const { vertices, indices } = buildTileMeshData(order, pix, this.config.frame, this.gridSegments);
    this.meshBuilds++;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer(), ibo = gl.createBuffer();
    if (!vao || !vbo || !ibo) {
      if (vao) gl.deleteVertexArray(vao);
      if (vbo) gl.deleteBuffer(vbo);
      if (ibo) gl.deleteBuffer(ibo);
      throw new Error('HiPS mesh allocation failed');
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.attribs.a_position);
    gl.vertexAttribPointer(this.attribs.a_position, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.attribs.a_uv);
    gl.vertexAttribPointer(this.attribs.a_uv, 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    const mesh = { vao, vbo, ibo, indexCount: indices.length };
    while (this.meshCache.size >= this.maxMeshes) {
      const oldest = [...this.meshCache.keys()].find(key => !this.protectedMeshes.has(key));
      // At most maxVisible <= maxMeshes distinct leaf meshes are protected.
      if (oldest === undefined) throw new Error('HiPS mesh working set exceeds cache budget');
      this.deleteMesh(this.meshCache.get(oldest)!);
      this.meshCache.delete(oldest);
    }
    this.meshCache.set(key, mesh);
    return mesh;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tileManager.dispose();
    for (const mesh of this.meshCache.values()) this.deleteMesh(mesh);
    this.meshCache.clear();
    this.protectedMeshes.clear();
    this.visibleLeaves = [];
    this.visibilityKey = [];
    if (this.program) this.gl.deleteProgram(this.program);
    this.program = null;
    this.drawn = this.fallbackDrawn = this.visible = 0;
  }

  private createProgram(vsrc: string, fsrc: string): WebGLProgram {
    const gl = this.gl;
    const shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null;
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vsrc], [gl.FRAGMENT_SHADER, fsrc]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('HiPS shader allocation failed');
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('HiPS shader: ' + gl.getShaderInfoLog(shader));
      }
      program = gl.createProgram();
      if (!program) throw new Error('HiPS program allocation failed');
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('HiPS link: ' + gl.getProgramInfoLog(program));
      return program;
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
}
