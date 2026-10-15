import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  ancestorTextureTransform, ang2pixNested, ang2vec, galacticToEquatorial,
  nest2xyf, nside2npix, order2nside, pix2angNested, pix2vecNested, pixChildren, pixParent,
} from '../src/hips/healpix';
import { buildTileMeshData, HipsRenderer } from '../src/hips/hips-renderer';
import { HipsTileManager, type HipsConfig } from '../src/hips/tile-manager';
import { chooseOrder, getVisibleTiles, tileAngularRadius, type VisibleTile } from '../src/hips/visibility';
import { computeSky, DEFAULT_LOCATION, transformDirection } from '../src/observer/astronomy';

// All tests are CPU/numerical or mocked WebGL/Image lifecycle tests. They do NOT
// claim browser/GPU rasterization, live survey availability, or visual seam proof.
type Vec = [number, number, number];
const D = Math.PI / 180;
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function close(a: number, b: number, tolerance = 1e-10) {
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}; tolerance=${tolerance}`);
}
function vectorClose(a: ArrayLike<number>, b: ArrayLike<number>, tolerance = 1e-10) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) close(a[i], b[i], tolerance);
}
function normalize(a: readonly number[]): Vec { const r = Math.hypot(...a); return a.map(x => x / r) as Vec; }
function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec, b: Vec) { return a.reduce((sum, x, i) => sum + x * b[i], 0); }
function eq(ra: number, dec: number): Vec {
  return [Math.cos(dec * D) * Math.cos(ra * D), Math.sin(dec * D), Math.cos(dec * D) * Math.sin(ra * D)];
}
function lookAt(direction: Vec): Float32Array {
  const f = normalize(direction);
  const r = normalize(cross(f, Math.abs(f[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]));
  const u = cross(r, f);
  return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, 0, 0, 0, 1]);
}
function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) m[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return m;
}
function perspective(fov: number, aspect = 1): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.02002, 0]);
}
function covers(tiles: readonly VisibleTile[], targetOrder: number, pix: number): boolean {
  return tiles.some(t => t.order <= targetOrder && Math.floor(pix / 4 ** (targetOrder - t.order)) === t.pix);
}
function noOverlappingLeaves(tiles: readonly VisibleTile[]) {
  assert.equal(new Set(tiles.map(t => `${t.order}/${t.pix}`)).size, tiles.length);
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const [a, b] = tiles[i].order <= tiles[j].order ? [tiles[i], tiles[j]] : [tiles[j], tiles[i]];
    assert.notEqual(Math.floor(b.pix / 4 ** (b.order - a.order)), a.pix, 'ancestor and descendant both selected');
  }
}

/** Independent continuous HEALPix ring/face equations (jrll/jpll), not the
 * implementation's planar inverse. Morton decoding here does not reuse helpers.
 * HEALPix paper: Gorski et al. 2005, ApJ 622, 759, doi:10.1086/427976. */
function referenceHealpix(n: number, pix: number, u = 0.5, v = 0.5): Vec {
  const face = Math.floor(pix / (n * n)), bits = pix % (n * n);
  let ix = 0, iy = 0;
  for (let b = 0; 2 ** b < n; b++) {
    ix += ((bits >> (2 * b)) & 1) * 2 ** b;
    iy += ((bits >> (2 * b + 1)) & 1) * 2 ** b;
  }
  const jr = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4][face] * n - ix - u - iy - v;
  let nr = n, z = (2 * n - jr) * 2 / (3 * n);
  if (jr < n) { nr = jr; z = 1 - nr * nr / (3 * n * n); }
  if (jr > 3 * n) { nr = 4 * n - jr; z = -1 + nr * nr / (3 * n * n); }
  const longitude = nr ? ([1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7][face] * nr + ix + u - iy - v) * Math.PI / (4 * nr) : 0;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(longitude), z, r * Math.sin(longitude)];
}

test('IAU Galactic axes match J2000 Galactic centre and north pole in engine Y-up', () => {
  // IAU J2000 l=0,b=0 and north Galactic pole, not the slightly offset Sgr A*.
  vectorClose(galacticToEquatorial([1, 0, 0]), eq(266.404994801, -28.93617396), 2e-10);
  vectorClose(galacticToEquatorial([0, 1, 0]), eq(192.85948, 27.12825), 2e-10);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => galacticToEquatorial(v));
  axes.forEach(a => close(Math.hypot(...a), 1));
  close(dot(axes[0], axes[1]), 0);
  close(dot(axes[0], axes[2]), 0);
  close(dot(axes[1], axes[2]), 0);
  vectorClose(cross(axes[0], axes[1]), axes[2]);
  // Base equatorial face 4 is the Galactic-centre direction, in actual mesh data.
  const mesh = buildTileMeshData(0, 4, 'galactic', 2);
  vectorClose(mesh.vertices.subarray(20, 23), eq(266.404994801, -28.93617396), 3e-8);
});

test('HEALPix centres, edges, polar caps and seams match independent ring/face equations', () => {
  for (const n of [1, 2, 4, 8, 16]) for (let p = 0; p < nside2npix(n); p++) {
    for (const [u, v] of [[0, 0], [0, 1], [1, 0], [1, 1], [0.17, 0.73], [0.5, 0.5]]) {
      const dir = pix2vecNested(n, p, u, v);
      vectorClose(dir, referenceHealpix(n, p, u, v), 4e-14);
      close(Math.hypot(...dir), 1, 2e-14);
    }
    const angles = pix2angNested(n, p);
    assert.equal(ang2pixNested(n, ...angles), p);
    vectorClose(ang2vec(...angles), pix2vecNested(n, p), 2e-14);
    const centre = pix2vecNested(n, p);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const distance = Math.acos(Math.max(-1, Math.min(1, dot(centre, pix2vecNested(n, p, u, v)))));
      assert.ok(distance <= tileAngularRadius(Math.log2(n)), 'culling cap encloses curved pixel edge');
    }
  }
  vectorClose(pix2vecNested(1, 4), [1, 0, 0]);
  vectorClose(pix2vecNested(1, 0), [Math.sqrt(5 / 18), 2 / 3, Math.sqrt(5 / 18)]);
  vectorClose(pix2vecNested(1, 8), [Math.sqrt(5 / 18), -2 / 3, Math.sqrt(5 / 18)]);
  for (let face = 0; face < 4; face++) vectorClose(pix2vecNested(1, face, 1, 1), [0, 1, 0]);
  for (let face = 8; face < 12; face++) vectorClose(pix2vecNested(1, face, 0, 0), [0, -1, 0]);
});

test('HEALPix child geometry exactly subdivides its parent, including polar faces', () => {
  for (let order = 0; order <= 4; order++) {
    const n = order2nside(order);
    for (let p = 0; p < 12 * n * n; p += Math.max(1, n - 1)) {
      for (let c = 0; c < 4; c++) {
        const child = pixChildren(p)[c];
        assert.equal(pixParent(child), p);
        const x = c & 1, y = (c >> 1) & 1;
        for (const [u, v] of [[0, 0], [1, 1], [0.25, 0.7], [0.5, 0.5]]) {
          vectorClose(pix2vecNested(n * 2, child, u, v), pix2vecNested(n, p, (x + u) / 2, (y + v) / 2), 4e-14);
        }
      }
    }
  }
});

test('mesh vertices follow exact HEALPix in both frames, with bounded valid indices', () => {
  for (const frame of ['equatorial', 'galactic'] as const) for (const [order, pix] of [[0, 0], [0, 11], [3, 192], [3, 511], [7, 12345]]) {
    const n = 12, mesh = buildTileMeshData(order, pix, frame, n);
    assert.equal(mesh.vertices.length, (n + 1) ** 2 * 5);
    assert.equal(mesh.indices.length, n * n * 6);
    assert.ok([...mesh.indices].every(i => i < (n + 1) ** 2));
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      let expected = referenceHealpix(2 ** order, pix, i / n, j / n);
      if (frame === 'galactic') expected = galacticToEquatorial(expected);
      const start = (j * (n + 1) + i) * 5;
      vectorClose(mesh.vertices.subarray(start, start + 3), expected, 3e-8);
      vectorClose(mesh.vertices.subarray(start + 3, start + 5), [j / n, i / n], 3e-8);
    }
  }
});

test('ancestor UV transforms select unique child regions, not repeated full-parent images', () => {
  const parent = 7;
  const quadrants = pixChildren(parent).map(child => ancestorTextureTransform(1, child, 0));
  assert.deepEqual(quadrants, [[0, 0, 0.5], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0.5]]);
  for (let order = 1; order <= 6; order++) {
    const count = 4 ** order, transforms = new Set<string>();
    let totalArea = 0;
    for (let i = 0; i < count; i++) {
      const pix = parent * count + i;
      const [ox, oy, scale] = ancestorTextureTransform(order, pix, 0);
      const { ix, iy } = nest2xyf(2 ** order, pix);
      vectorClose([ox, oy, scale], [iy / 2 ** order, ix / 2 ** order, 1 / 2 ** order]);
      assert.ok(ox >= 0 && oy >= 0 && ox + scale <= 1 && oy + scale <= 1);
      transforms.add(`${ox},${oy}`);
      totalArea += scale * scale;
      const [u, v] = [0.13, 0.79];
      vectorClose(pix2vecNested(2 ** order, pix, u, v), pix2vecNested(1, parent, oy + u * scale, ox + v * scale), 3e-14);
      // Composing one-level sampling with the remaining ancestor is identical.
      if (order > 1) {
        const a = ancestorTextureTransform(order, pix, order - 1);
        const b = ancestorTextureTransform(order - 1, Math.floor(pix / 4), 0);
        vectorClose([b[0] + a[0] * b[2], b[1] + a[1] * b[2], a[2] * b[2]], [ox, oy, scale]);
      }
    }
    assert.equal(transforms.size, count);
    close(totalArea, 1);
  }
  assert.deepEqual(ancestorTextureTransform(4, 875, 4), [0, 0, 1]);
  assert.throws(() => ancestorTextureTransform(3, 7, 4), RangeError);
});

test('LOD uses radians and screen resolution only, never loaded state', () => {
  assert.equal(chooseOrder(10 * D, 1080, 512, 8), 4);
  assert.equal(chooseOrder(10 * D, 1080, 512, 3), 3);
  assert.equal(chooseOrder(1 * D, 1080, 512, 8), 7);
  assert.equal(chooseOrder(120 * D, 600, 512, 8), 0);
  assert.equal(chooseOrder(0, 600, 512, 8), 0);
  assert.equal(chooseOrder(10 * D, 0, 512, 8), 0);
});

test('frustum culling consumes camera horizon view × EQ-to-horizontal, in correct survey frame', () => {
  const sky = computeSky(new Date('2026-10-13T12:00:00Z'), DEFAULT_LOCATION);
  const gc = eq(266.404994801, -28.93617396);
  const horizontal = transformDirection(sky.equatorialToHorizontal, gc);
  const view = multiply(lookAt(horizontal), sky.equatorialToHorizontal);
  vectorClose(transformDirection(view, gc), [0, 0, -1], 1e-7);
  const order = 6, fov = 2 * D, proj = perspective(fov, 1.7);
  const gcPix = ang2pixNested(2 ** order, Math.PI / 2, 0);
  const visible = getVisibleTiles(order, view, proj, fov, 'galactic', 256);
  assert.ok(covers(visible, order, gcPix), 'Galactic-centre survey tile must be in the view');
  assert.ok(!covers(visible, order, ang2pixNested(2 ** order, Math.PI / 2, Math.PI)), 'opposite Galactic direction culled');
  assert.ok(!covers(getVisibleTiles(order, view, proj, fov, 'equatorial', 256), order, gcPix), 'same numeric pixel in wrong frame is not visible');
  // Infinite-sky culling ignores camera translation and near/far planes.
  const translated = view.slice(); translated[12] = 1000; translated[13] = -500; translated[14] = 70;
  assert.deepEqual(getVisibleTiles(order, translated, proj, fov, 'galactic', 256), visible);
});

test('bounded culling conservatively covers sampled screen rays without overlapping leaves', () => {
  const order = 6;
  for (const frame of ['equatorial', 'galactic'] as const) for (const direction of [eq(0, 0), eq(359.9, 85), eq(92, -88), eq(266.405, -28.936)]) {
    for (const [fov, aspect, budget] of [[5 * D, 2, 512], [100 * D, 0.6, 12], [60 * D, 2, 48]]) {
      const view = lookAt(direction), proj = perspective(fov, aspect);
      const tiles = getVisibleTiles(order, view, proj, fov, frame, budget);
      assert.ok(tiles.length <= budget);
      noOverlappingLeaves(tiles);
      for (let sx = -1; sx <= 1; sx += 0.2) for (let sy = -1; sy <= 1; sy += 0.2) {
        const ray = normalize([sx * Math.tan(fov / 2) * aspect, sy * Math.tan(fov / 2), -1]);
        let world: Vec = [dot([view[0], view[1], view[2]], ray), dot([view[4], view[5], view[6]], ray), dot([view[8], view[9], view[10]], ray)];
        if (frame === 'galactic') world = [dot(galacticToEquatorial([1, 0, 0]), world), dot(galacticToEquatorial([0, 1, 0]), world), dot(galacticToEquatorial([0, 0, 1]), world)];
        const p = ang2pixNested(2 ** order, Math.acos(Math.max(-1, Math.min(1, world[1]))), Math.atan2(world[2], world[0]));
        assert.ok(covers(tiles, order, p), `${frame}: missed screen (${sx}, ${sy}); budget=${budget}`);
      }
    }
  }
});

interface Resource { id: number; kind: string }
/** Minimal stateful WebGL2 mock: records actual submitted mesh buffers, texture
 * transforms, state restoration and allocation/deletion; never rasterizes. */
class FakeGL {
  readonly DEPTH_TEST = 1; readonly CULL_FACE = 2; readonly DEPTH_WRITEMASK = 3;
  readonly CURRENT_PROGRAM = 4; readonly VERTEX_ARRAY_BINDING = 5; readonly ARRAY_BUFFER_BINDING = 6;
  readonly ACTIVE_TEXTURE = 7; readonly TEXTURE_BINDING_2D = 8; readonly UNPACK_FLIP_Y_WEBGL = 9;
  readonly TEXTURE0 = 100; readonly TEXTURE_2D = 101; readonly ARRAY_BUFFER = 102; readonly ELEMENT_ARRAY_BUFFER = 103;
  readonly STATIC_DRAW = 104; readonly FLOAT = 105; readonly TRIANGLES = 106; readonly UNSIGNED_SHORT = 107;
  readonly RGBA = 108; readonly UNSIGNED_BYTE = 109; readonly TEXTURE_WRAP_S = 110; readonly TEXTURE_WRAP_T = 111;
  readonly CLAMP_TO_EDGE = 112; readonly TEXTURE_MIN_FILTER = 113; readonly TEXTURE_MAG_FILTER = 114; readonly LINEAR = 115;
  readonly VERTEX_SHADER = 116; readonly FRAGMENT_SHADER = 117; readonly COMPILE_STATUS = 118; readonly LINK_STATUS = 119;
  enabled = new Set([this.DEPTH_TEST, this.CULL_FACE]);
  params = new Map<number, any>([[this.DEPTH_WRITEMASK, true], [this.ACTIVE_TEXTURE, this.TEXTURE0], [this.UNPACK_FLIP_Y_WEBGL, true]]);
  bindings = new Map<number, Resource | null>();
  created: Resource[] = [];
  deleted: Resource[] = [];
  data = new Map<Resource, Float32Array | Uint16Array>();
  vaoBuffers = new Map<Resource, Resource>();
  uniforms = new Map<string, any>();
  draws: { vao: Resource; texture: Resource; transform: Vec; count: number }[] = [];
  uploadThrows = false;
  textureAllocationFails = false;
  bufferAllocationFails = false;
  compileOK = true;
  linkOK = true;
  drawThrows = false;
  private resource(kind: string): Resource { const r = { id: this.created.length + 1, kind }; this.created.push(r); return r; }
  context(): WebGL2RenderingContext { return this as unknown as WebGL2RenderingContext; }
  createShader() { return this.resource('shader'); }
  shaderSource() {} compileShader() {} attachShader() {} linkProgram() {}
  getShaderParameter() { return this.compileOK; } getShaderInfoLog() { return 'mock compile failure'; }
  getProgramParameter() { return this.linkOK; } getProgramInfoLog() { return 'mock link failure'; }
  createProgram() { return this.resource('program'); }
  getUniformLocation(_p: unknown, name: string) { return name; }
  getAttribLocation(_p: unknown, name: string) { return name === 'a_position' ? 0 : 1; }
  createVertexArray() { return this.resource('vao'); }
  createBuffer() { return this.bufferAllocationFails ? null : this.resource('buffer'); }
  createTexture() { return this.textureAllocationFails ? null : this.resource('texture'); }
  deleteShader(r: Resource) { this.deleted.push(r); }
  deleteProgram(r: Resource) { this.deleted.push(r); }
  deleteVertexArray(r: Resource) { this.deleted.push(r); }
  deleteBuffer(r: Resource) { this.deleted.push(r); }
  deleteTexture(r: Resource) { this.deleted.push(r); }
  bindVertexArray(r: Resource | null) { this.params.set(this.VERTEX_ARRAY_BINDING, r); }
  bindBuffer(target: number, r: Resource | null) {
    this.params.set(target === this.ARRAY_BUFFER ? this.ARRAY_BUFFER_BINDING : target, r);
    if (target === this.ARRAY_BUFFER && r && this.params.get(this.VERTEX_ARRAY_BINDING)) this.vaoBuffers.set(this.params.get(this.VERTEX_ARRAY_BINDING), r);
  }
  bufferData(target: number, data: Float32Array | Uint16Array) { this.data.set(this.params.get(target === this.ARRAY_BUFFER ? this.ARRAY_BUFFER_BINDING : target), data.slice()); }
  enableVertexAttribArray() {} vertexAttribPointer() {} texParameteri() {}
  texImage2D() { if (this.uploadThrows) throw new Error('mock upload failure'); }
  activeTexture(unit: number) { this.params.set(this.ACTIVE_TEXTURE, unit); }
  bindTexture(_target: number, r: Resource | null) { this.bindings.set(this.params.get(this.ACTIVE_TEXTURE), r); }
  getParameter(p: number) { return p === this.TEXTURE_BINDING_2D ? this.bindings.get(this.params.get(this.ACTIVE_TEXTURE)) ?? null : this.params.get(p) ?? null; }
  pixelStorei(p: number, value: unknown) { this.params.set(p, value); }
  isEnabled(p: number) { return this.enabled.has(p); } enable(p: number) { this.enabled.add(p); } disable(p: number) { this.enabled.delete(p); }
  depthMask(value: boolean) { this.params.set(this.DEPTH_WRITEMASK, value); }
  useProgram(r: Resource | null) { this.params.set(this.CURRENT_PROGRAM, r); }
  uniformMatrix4fv(name: string, _transpose: boolean, value: Float32Array) { this.uniforms.set(name, value.slice()); }
  uniform1f(name: string, value: number) { this.uniforms.set(name, value); }
  uniform1i(name: string, value: number) { this.uniforms.set(name, value); }
  uniform3f(name: string, x: number, y: number, z: number) { this.uniforms.set(name, [x, y, z]); }
  drawElements(_mode: number, count: number) {
    if (this.drawThrows) throw new Error('mock draw failure');
    this.draws.push({ vao: this.params.get(this.VERTEX_ARRAY_BINDING), texture: this.getParameter(this.TEXTURE_BINDING_2D), transform: this.uniforms.get('u_texTransform').slice(), count });
  }
  assertDisposed() {
    assert.equal(this.deleted.length, new Set(this.deleted).size, 'every resource deleted once');
    assert.deepEqual(new Set(this.deleted), new Set(this.created), 'all allocated GL resources disposed');
  }
}
class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  naturalWidth = 512;
  naturalHeight = 512;
  src = '';
  constructor() { FakeImage.instances.push(this); }
  succeed() { this.onload?.(); }
  fail() { this.onerror?.(); }
}
const config = (extra: Partial<HipsConfig> = {}): HipsConfig => ({ url: 'https://example.invalid/survey/', maxOrder: 8, tileSize: 512, format: 'jpg', frame: 'galactic', ...extra });
function imageMock(t: TestContext) {
  FakeImage.instances = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'Image', { value: FakeImage, configurable: true, writable: true });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'Image', descriptor); else delete (globalThis as any).Image; });
}
function drainImages(outcome: 'succeed' | 'fail' = 'succeed') {
  let completed = 0;
  for (let i = 0; i < FakeImage.instances.length; i++) {
    const image = FakeImage.instances[i];
    if (image.onload || image.onerror) { image[outcome](); completed++; }
    assert.ok(completed < 1000, 'finite queue drain');
  }
  return completed;
}
function decodeUrl(url: string) {
  const m = /Norder(\d+)\/Dir(\d+)\/Npix(\d+)\.jpg$/.exec(url);
  assert.ok(m, `bad URL: ${url}`);
  return { order: Number(m[1]), dir: Number(m[2]), pix: Number(m[3]) };
}
function fixture(t: TestContext, extra: Partial<HipsConfig> = {}) {
  imageMock(t);
  const gl = new FakeGL(), manager = new HipsTileManager(gl.context(), config(extra));
  t.after(() => manager.dispose());
  return { gl, manager };
}
function rendererFixture(t: TestContext, extra: Partial<HipsConfig> = {}) {
  imageMock(t);
  const gl = new FakeGL(), renderer = new HipsRenderer(gl.context(), config(extra));
  t.after(() => renderer.dispose());
  renderer.init();
  return { gl, renderer };
}

test('target requests progress to high order with no loaded tile, independently of ancestors', t => {
  const { manager } = fixture(t, { maxConcurrentLoads: 2, maxRetries: 0 });
  manager.updateVisibleTiles([{ order: 6, pix: 12345, priority: 1 }]);
  assert.equal(manager.getStats().loaded, 0);
  assert.equal(manager.getStats().loading, 2);
  assert.equal(manager.getStats().queued, 5);
  const urls: string[] = [];
  for (let i = 0; i < FakeImage.instances.length; i++) {
    urls.push(FakeImage.instances[i].src);
    FakeImage.instances[i].fail();
  }
  assert.equal(manager.getStats().loaded, 0);
  assert.deepEqual(urls.map(url => decodeUrl(url).order), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(decodeUrl(urls[6]).pix, 12345);
  assert.equal(decodeUrl(urls[6]).dir, 10000);
  assert.equal(manager.getStats().loading, 0);
  assert.equal(manager.getStats().failed, 7);
});

test('renderer retains targetOrder at cold start, draws only when images load, and reports required stats', t => {
  const { renderer, gl } = rendererFixture(t, { maxOrder: 3, maxRetries: 0 });
  const fov = 5 * D, view = lookAt(eq(266.405, -28.936)), proj = perspective(fov, 1.5);
  const render = () => renderer.render(view, proj, fov, [1200, 800]);
  render();
  assert.equal(renderer.getStats().targetOrder, 3);
  assert.equal(renderer.getStats().drawn, 0);
  assert.equal(renderer.getStats().loaded, 0);
  assert.ok(renderer.getStats().loading > 0);
  // Fail all coarse images: loading ancestors must not gate fine requests.
  const requests: number[] = [];
  for (let frame = 0; frame < 4; frame++) {
    for (let i = 0; i < FakeImage.instances.length; i++) if (FakeImage.instances[i].onerror) {
      requests.push(decodeUrl(FakeImage.instances[i].src).order);
      FakeImage.instances[i].fail();
    }
    render();
  }
  assert.ok(requests.includes(3));
  assert.equal(renderer.getStats().loaded, 0);
  assert.equal(renderer.getStats().drawn, 0);
  assert.equal(renderer.getStats().targetOrder, 3);
  assert.ok(renderer.getStats().failed > 0);
  assert.equal(gl.draws.length, 0);
});

test('renderer draws disjoint leaf geometry with ancestor UV, and exact children replace fallback once', t => {
  const { renderer, gl } = rendererFixture(t, { maxOrder: 3, maxConcurrentLoads: 1 });
  const fov = 8 * D, view = lookAt(eq(266.405, -28.936)), proj = perspective(fov, 1.5);
  const leaves = getVisibleTiles(3, view, proj, fov, 'galactic', 128);
  const render = () => renderer.render(view, proj, fov, [1200, 800]);
  render();
  const first = FakeImage.instances[0], parent = decodeUrl(first.src);
  assert.equal(parent.order, 0);
  first.succeed();
  gl.draws = [];
  render();
  const drawable = leaves.filter(t => Math.floor(t.pix / 4 ** t.order) === parent.pix);
  assert.equal(gl.draws.length, drawable.length);
  assert.ok(gl.draws.length > 1);
  assert.equal(renderer.getStats().fallbackDrawn, drawable.length);
  assert.equal(new Set(gl.draws.map(d => d.vao)).size, drawable.length, 'never redraw the full parent mesh');
  for (let i = 0; i < gl.draws.length; i++) {
    assert.deepEqual(gl.draws[i].transform, ancestorTextureTransform(drawable[i].order, drawable[i].pix, 0));
    assert.ok(gl.draws[i].transform[2] < 1);
    const buffer = gl.vaoBuffers.get(gl.draws[i].vao)!;
    assert.deepEqual(gl.data.get(buffer), buildTileMeshData(drawable[i].order, drawable[i].pix, 'galactic').vertices);
  }
  for (let i = 0; i < 5; i++) { drainImages(); render(); }
  gl.draws = [];
  render();
  assert.equal(renderer.getStats().drawn, leaves.length);
  assert.equal(renderer.getStats().fallbackDrawn, 0);
  assert.equal(gl.draws.length, leaves.length);
  assert.ok(gl.draws.every(d => d.transform[0] === 0 && d.transform[1] === 0 && d.transform[2] === 1));
  vectorClose(gl.uniforms.get('u_viewMatrix'), view);
  vectorClose(gl.uniforms.get('u_projMatrix'), proj);
});

test('render pass restores depth, culling, program, VAO, buffer and both texture-unit bindings', t => {
  const { renderer, gl } = rendererFixture(t, { maxOrder: 0 });
  const render = () => renderer.render(identity(), perspective(60 * D), 60 * D, [800, 800]);
  render(); drainImages(); render(); drainImages();
  const program = gl.createProgram(), vao = gl.createVertexArray(), buffer = gl.createBuffer();
  const texture0 = gl.createTexture(), texture3 = gl.createTexture();
  gl.useProgram(program); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture0);
  gl.activeTexture(gl.TEXTURE0 + 3); gl.bindTexture(gl.TEXTURE_2D, texture3);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(true);
  const check = () => {
    assert.equal(gl.isEnabled(gl.DEPTH_TEST), true); assert.equal(gl.isEnabled(gl.CULL_FACE), false);
    assert.equal(gl.getParameter(gl.DEPTH_WRITEMASK), true);
    assert.equal(gl.getParameter(gl.CURRENT_PROGRAM), program);
    assert.equal(gl.getParameter(gl.VERTEX_ARRAY_BINDING), vao);
    assert.equal(gl.getParameter(gl.ARRAY_BUFFER_BINDING), buffer);
    assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE), gl.TEXTURE0 + 3);
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), texture3);
    assert.equal(gl.bindings.get(gl.TEXTURE0), texture0);
  };
  render(); check();
  gl.drawThrows = true;
  assert.throws(render, /mock draw failure/); check();
});

test('loading queue, concurrent images, texture cache, negative cache and mesh cache stay bounded', t => {
  const { renderer, gl } = rendererFixture(t, { maxOrder: 4, maxCacheTiles: 24, maxConcurrentLoads: 2, maxQueuedLoads: 7, maxMeshTiles: 48, maxVisibleTiles: 48 });
  for (let step = 0; step < 24; step++) {
    const view = lookAt(eq(step * 67, Math.sin(step) * 70)), fov = 7 * D;
    for (let frame = 0; frame < 4; frame++) {
      renderer.render(view, perspective(fov, 1.5), fov, [1200, 800]);
      let stats = renderer.getStats();
      assert.ok(stats.loading <= 2); assert.ok(stats.queued <= 7); assert.ok(stats.cached <= 24);
      assert.ok(stats.meshes <= 48); assert.ok(stats.visible <= 48); assert.ok(stats.drawn <= 48); assert.ok(stats.failed <= 24);
      drainImages(step % 5 === 0 ? 'fail' : 'succeed');
      stats = renderer.getStats();
      assert.ok(stats.loaded <= 24); assert.ok(stats.loading <= 2);
    }
  }
  assert.ok(gl.created.filter(r => r.kind === 'texture').length > 24, 'exercise texture eviction');
  assert.ok(gl.deleted.some(r => r.kind === 'texture'));
  assert.ok(gl.deleted.some(r => r.kind === 'vao'), 'exercise mesh eviction');
  renderer.dispose(); renderer.dispose(); gl.assertDisposed();
  const before = gl.created.length;
  renderer.init(); renderer.render(identity(), perspective(1), 1, [800, 800]);
  assert.equal(gl.created.length, before);
  assert.equal(renderer.getStats().loading, 0); assert.equal(renderer.getStats().loaded, 0);
  assert.equal(renderer.getStats().drawn, 0); assert.equal(renderer.getStats().meshes, 0);
});

test('view change discards stale queued work while retaining bounded in-flight loads', t => {
  const { manager } = fixture(t, { maxConcurrentLoads: 1, maxQueuedLoads: 8 });
  manager.updateVisibleTiles([{ order: 3, pix: 5 }]);
  assert.equal(FakeImage.instances.length, 1);
  manager.updateVisibleTiles([{ order: 3, pix: 11 * 64 + 7 }]);
  const old = FakeImage.instances[0]; old.succeed();
  const next = decodeUrl(FakeImage.instances[1].src);
  assert.deepEqual(next, { order: 0, pix: 11, dir: 0 });
  assert.equal(manager.getStats().loading, 1);
  assert.ok(manager.getStats().queued <= 8);
});

test('image failures back off exponentially, respect retry cap, and release each load exactly once', t => {
  const { manager, gl } = fixture(t, { maxConcurrentLoads: 1, maxRetries: 2, retryDelayMs: 100 });
  let now = 10000; t.mock.method(Date, 'now', () => now);
  manager.requestTile(3, 222);
  assert.equal(FakeImage.instances[0].crossOrigin, 'anonymous');
  const error = FakeImage.instances[0].onerror!;
  error(); error();
  assert.equal(manager.getStats().loading, 0); assert.equal(manager.getStats().failuresTotal, 1);
  manager.requestTile(3, 222); assert.equal(FakeImage.instances.length, 1);
  now += 99; manager.requestTile(3, 222); assert.equal(FakeImage.instances.length, 1);
  now++; manager.requestTile(3, 222); assert.equal(FakeImage.instances.length, 2);
  FakeImage.instances[1].fail();
  now += 199; manager.requestTile(3, 222); assert.equal(FakeImage.instances.length, 2);
  now++; manager.requestTile(3, 222); assert.equal(FakeImage.instances.length, 3);
  FakeImage.instances[2].fail();
  now += 100000; manager.requestTile(3, 222); assert.equal(FakeImage.instances.length, 3);
  assert.equal(manager.getStats().failed, 1); assert.equal(manager.getStats().failuresTotal, 3);
  assert.equal(manager.getStats().loading, 0); assert.equal(manager.getStats().loaded, 0);
  assert.equal(gl.created.filter(r => r.kind === 'texture').length, 0);
});

test('successful retry clears failed status and texture upload preserves caller binding/flip state', t => {
  const { manager, gl } = fixture(t, { maxRetries: 1, retryDelayMs: 100 });
  let now = 20000; t.mock.method(Date, 'now', () => now);
  manager.requestTile(1, 8); FakeImage.instances[0].fail();
  now += 100; manager.requestTile(1, 8);
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + 4); gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  FakeImage.instances[1].succeed();
  assert.equal(manager.getStats().failed, 0); assert.equal(manager.getStats().failuresTotal, 1);
  assert.equal(manager.getStats().loaded, 1); assert.equal(manager.getStats().loading, 0);
  assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE), gl.TEXTURE0 + 4);
  assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), texture);
  assert.equal(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), true);
  const tile = manager.getTileOrAncestor(3, 8 * 16 + 13, false)!;
  assert.equal(tile.order, 1); assert.equal(tile.pix, 8);
  assert.equal(manager.getTileOrAncestor(3, 1, false), null);
});

for (const failure of ['zero-size', 'upload', 'allocation'] as const) {
  test(`image ${failure} failure cleans resources and pumps next pending tile`, t => {
    const { manager, gl } = fixture(t, { maxConcurrentLoads: 1, maxRetries: 0 });
    manager.requestTile(1, 1); manager.requestTile(1, 2);
    if (failure === 'zero-size') FakeImage.instances[0].naturalWidth = 0;
    if (failure === 'upload') gl.uploadThrows = true;
    if (failure === 'allocation') gl.textureAllocationFails = true;
    const callerTexture = { id: -1, kind: 'external-texture' };
    gl.bindTexture(gl.TEXTURE_2D, callerTexture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    FakeImage.instances[0].succeed();
    assert.equal(manager.getStats().loading, 1); assert.equal(manager.getStats().failed, 1);
    assert.equal(FakeImage.instances.length, 2);
    assert.equal(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), true);
    assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), callerTexture);
    gl.uploadThrows = false; gl.textureAllocationFails = false;
    FakeImage.instances[1].succeed();
    assert.equal(manager.getStats().loading, 0); assert.equal(manager.getStats().loaded, 1);
    manager.dispose(); gl.assertDisposed();
  });
}

test('image timeout releases slot, backs off, and rejects late image callbacks', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { manager } = fixture(t, { maxConcurrentLoads: 1, maxRetries: 0, loadTimeoutMs: 100 });
  manager.requestTile(1, 1); manager.requestTile(1, 2);
  const oldImage = FakeImage.instances[0], lateLoad = oldImage.onload!, lateError = oldImage.onerror!;
  t.mock.timers.tick(100);
  assert.equal(manager.getStats().failed, 1); assert.equal(manager.getStats().loading, 1);
  assert.equal(oldImage.src, ''); assert.equal(oldImage.onload, null); assert.equal(oldImage.onerror, null);
  lateLoad(); lateError();
  assert.equal(manager.getStats().failed, 1); assert.equal(manager.getStats().loaded, 0);
  FakeImage.instances[1].succeed();
  t.mock.timers.tick(1000);
  assert.equal(manager.getStats().loaded, 1); assert.equal(manager.getStats().loading, 0);
});

test('dispose cancels images/timers/queue, deletes textures once and prevents callback resurrection', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { manager, gl } = fixture(t, { maxConcurrentLoads: 2 });
  manager.requestTile(2, 1); manager.requestTile(2, 2); manager.requestTile(2, 3); manager.requestTile(2, 4);
  FakeImage.instances[0].succeed();
  const active = FakeImage.instances.filter(i => i.onload);
  const lateCallbacks = active.flatMap(i => [i.onload!, i.onerror!]);
  assert.equal(manager.getStats().loaded, 1); assert.equal(manager.getStats().loading, 2);
  manager.dispose(); manager.dispose();
  for (const image of active) { assert.equal(image.onload, null); assert.equal(image.onerror, null); assert.equal(image.src, ''); }
  for (const callback of lateCallbacks) callback();
  t.mock.timers.tick(60000);
  const before = FakeImage.instances.length; manager.requestTile(0, 5); manager.updateVisibleTiles([{ order: 1, pix: 8 }]);
  assert.equal(FakeImage.instances.length, before);
  const stats = manager.getStats();
  assert.equal(stats.cached, 0); assert.equal(stats.loaded, 0); assert.equal(stats.loading, 0); assert.equal(stats.queued, 0); assert.equal(stats.failed, 0);
  gl.assertDisposed();
});

test('shader compile/link failures delete partial GL resources, and init can be retried', t => {
  imageMock(t);
  for (const stage of ['compile', 'link'] as const) {
    const gl = new FakeGL(), renderer = new HipsRenderer(gl.context(), config());
    if (stage === 'compile') gl.compileOK = false; else gl.linkOK = false;
    assert.throws(() => renderer.init(), /HiPS (shader|link):/);
    gl.assertDisposed();
    gl.compileOK = true; gl.linkOK = true;
    renderer.init(); renderer.init(); renderer.dispose(); renderer.dispose();
    gl.assertDisposed();
  }
});

// Nonlinear refraction must be shared with stars, not approximated by a fixed matrix.
import { hipsViewDirection } from '../src/hips/hips-renderer';
import { REFRACTION_CULL_MARGIN_RAD, refractHorizonDirection } from '../src/hips/refraction';
import { refractedAltitude, horizontalDirection } from '../src/observer/astronomy';

test('HiPS and star directions align with refraction on/off across the horizon and both poles',()=>{
  const sky=computeSky(new Date('2026-10-13T12:00:00Z'),DEFAULT_LOCATION),matrix=sky.equatorialToHorizontal;
  const inverse=matrix.slice();for(let c=0;c<3;c++)for(let r=0;r<3;r++)inverse[c*4+r]=matrix[r*4+c];
  for(const az of [0,60,180,270])for(const altitude of [-90,-5,-1,-.4,0,1,15,70,89.9,90]){
    const h=horizontalDirection(az,altitude),catalog=transformDirection(inverse,h),apparent=horizontalDirection(az,refractedAltitude(altitude));
    vectorClose(refractHorizonDirection(h),apparent,1e-9);
    const horizonView=lookAt(apparent),view=multiply(horizonView,matrix);
    const on=hipsViewDirection(catalog,view,{horizontalView:horizonView,equatorialToHorizontal:matrix,refraction:true});
    vectorClose(on,[0,0,-1],2e-7);
    vectorClose(hipsViewDirection(catalog,view,{horizontalView:horizonView,equatorialToHorizontal:matrix,refraction:false}),hipsViewDirection(catalog,view),1e-12);
    const shift=Math.abs(refractedAltitude(altitude)-altitude)*D;
    assert.ok(shift<REFRACTION_CULL_MARGIN_RAD);
  }
});

test('refraction margin keeps a tile shifted into a narrow horizon field from being culled early',()=>{
  const geometric=horizontalDirection(0,-.4),apparent=horizontalDirection(0,refractedAltitude(-.4));
  const view=lookAt(apparent),fov=.1*D,proj=perspective(fov),order=10;
  const pix=ang2pixNested(2**order,Math.acos(geometric[1]),Math.atan2(geometric[2],geometric[0]));
  const without=getVisibleTiles(order,view,proj,fov,'equatorial',512,0);
  const withMargin=getVisibleTiles(order,view,proj,fov,'equatorial',512,REFRACTION_CULL_MARGIN_RAD);
  assert.equal(covers(without,order,pix),false,'fixture actually lies outside the un-refracted frustum');
  assert.equal(covers(withMargin,order,pix),true,'refracted visible geometry must survive hierarchical culling');
  assert.ok(withMargin.length<=512);noOverlappingLeaves(withMargin);
});

test('HiPS vertex pass receives separate horizon/view matrices and disables refraction cleanly',t=>{
  const {renderer,gl}=rendererFixture(t,{maxOrder:0});
  const sky=computeSky(new Date('2026-10-13T12:00:00Z'),DEFAULT_LOCATION),horizonView=lookAt(horizontalDirection(30,0));
  const view=multiply(horizonView,sky.equatorialToHorizontal),proj=perspective(20*D);
  renderer.render(view,proj,20*D,[800,800],{equatorialToHorizontal:sky.equatorialToHorizontal,horizontalView:horizonView,refraction:true});
  assert.equal(gl.uniforms.get('u_refraction'),1);
  vectorClose(gl.uniforms.get('u_equatorialToHorizontal'),sky.equatorialToHorizontal);
  vectorClose(gl.uniforms.get('u_horizontalView'),horizonView);
  renderer.render(view,proj,20*D,[800,800]);assert.equal(gl.uniforms.get('u_refraction'),0);
});

// Complete-base coverage checks inspect real submitted leaf meshes and sampled
// screen directions. They are protocol/CPU evidence, NOT GPU pixel evidence.
function completeFrame(renderer: HipsRenderer, gl: FakeGL, view: Float32Array,
  fov: number, viewport: [number, number], budget = 128) {
  const proj = perspective(fov, viewport[0] / viewport[1]);
  gl.draws = [];
  renderer.render(view, proj, fov, viewport);
  const stats = renderer.getStats();
  assert.equal(stats.baseReady, true);
  assert.equal(stats.baseLoaded, 12);
  const leaves = getVisibleTiles(stats.targetOrder, view, proj, fov, 'galactic', budget);
  assert.ok(leaves.length > 0);
  assert.equal(stats.drawn, leaves.length);
  assert.equal(stats.visible, leaves.length);
  assert.equal(gl.draws.length, leaves.length, 'one draw per leaf, never base + detail layers');
  assert.equal(new Set(gl.draws.map(d => d.vao)).size, leaves.length);
  noOverlappingLeaves(leaves);
  for (let i = 0; i < leaves.length; i++) {
    const { order, pix } = leaves[i];
    assert.deepEqual(gl.data.get(gl.vaoBuffers.get(gl.draws[i].vao)!), buildTileMeshData(order, pix, 'galactic').vertices);
    assert.ok(gl.draws[i].texture && !gl.deleted.includes(gl.draws[i].texture));
  }
  // Independent screen rays must be contained by one (not zero or two) drawn leaf.
  for (const sx of [-1, -.7, -.3, 0, .3, .7, 1]) for (const sy of [-1, -.5, 0, .5, 1]) {
    const ray = normalize([sx * Math.tan(fov / 2) * viewport[0] / viewport[1], sy * Math.tan(fov / 2), -1]);
    const eqRay: Vec = [dot([view[0], view[1], view[2]], ray), dot([view[4], view[5], view[6]], ray), dot([view[8], view[9], view[10]], ray)];
    const world: Vec = [dot(galacticToEquatorial([1, 0, 0]), eqRay), dot(galacticToEquatorial([0, 1, 0]), eqRay), dot(galacticToEquatorial([0, 0, 1]), eqRay)];
    const pix = ang2pixNested(64, Math.acos(Math.max(-1, Math.min(1, world[1]))), Math.atan2(world[2], world[0]));
    assert.equal(leaves.filter(t => Math.floor(pix / 4 ** (6 - t.order)) === t.pix).length, 1, 'sampled screen ray has exactly one drawn leaf');
  }
  return leaves;
}
const rootCompletionOrder = [7, 2, 11, 0, 9, 4, 1, 10, 6, 3, 8, 5];

for (let heldRoot = 0; heldRoot < 12; heldRoot++) {
  test(`complete base atomically enables only after out-of-order roots 0–11, holding root ${heldRoot}`, t => {
    const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxOrder: 3,
      maxCacheTiles: 48, maxConcurrentLoads: 12, maxQueuedLoads: 12 });
    const view = lookAt(eq(266.405, -28.936)), fov = 8 * D, viewport: [number, number] = [1190, 647];
    const render = () => { gl.draws = []; renderer.render(view, perspective(fov, viewport[0] / viewport[1]), fov, viewport); };
    render();
    assert.equal(renderer.getStats().targetOrder, 3, 'target LOD remains independent of base readiness');
    assert.equal(renderer.getStats().baseReady, false);
    assert.equal(FakeImage.instances.length, 12);
    const images = new Map(FakeImage.instances.map(image => [decodeUrl(image.src).pix, image]));
    assert.deepEqual([...images.keys()].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i));
    assert.ok(FakeImage.instances.every(image => decodeUrl(image.src).order === 0));
    let loaded = 0;
    for (const pix of rootCompletionOrder.filter(pix => pix !== heldRoot)) {
      images.get(pix)!.succeed(); loaded++; render();
      assert.equal(renderer.getStats().baseLoaded, loaded);
      assert.equal(renderer.getStats().baseReady, false);
      assert.equal(renderer.getStats().baseFailed, 0);
      assert.equal(renderer.getStats().drawn, 0);
      assert.equal(gl.draws.length, 0);
      assert.equal(renderer.getStats().meshes, 0);
      assert.equal(FakeImage.instances.length, 12, 'no detail request bypasses incomplete base');
    }
    images.get(heldRoot)!.succeed();
    assert.equal(renderer.getStats().baseReady, true);
    assert.equal(renderer.getStats().drawn, 0, 'upload alone does not draw a partial frame');
    completeFrame(renderer, gl, view, fov, viewport);
    assert.equal(renderer.getStats().fallbackDrawn, renderer.getStats().visible);
    assert.ok(FakeImage.instances.slice(12).some(image => decodeUrl(image.src).order > 0));
    renderer.dispose(); gl.assertDisposed();
  });
}

test('complete base retries a failed root within the shared finite backoff, then recovers atomically', t => {
  const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxOrder: 3, maxConcurrentLoads: 12,
    maxQueuedLoads: 12, maxRetries: 2, retryDelayMs: 100 });
  let now = 10000; t.mock.method(Date, 'now', () => now);
  const view = lookAt(eq(266.405, -28.936)), fov = 8 * D, viewport: [number, number] = [1190, 647];
  const render = () => renderer.render(view, perspective(fov, viewport[0] / viewport[1]), fov, viewport);
  render();
  const failed = FakeImage.instances[4], lateCallbacks = [failed.onload!, failed.onerror!];
  failed.fail();
  for (const image of FakeImage.instances) if (image !== failed) image.succeed();
  render();
  assert.equal(renderer.getStats().baseLoaded, 11);
  assert.equal(renderer.getStats().baseFailed, 0);
  assert.equal(renderer.getStats().drawn, 0);
  now += 99; render(); assert.equal(FakeImage.instances.length, 12);
  now++; render(); assert.equal(FakeImage.instances.length, 13);
  assert.equal(decodeUrl(FakeImage.instances[12].src).pix, 4);
  FakeImage.instances[12].fail();
  now += 199; render(); assert.equal(FakeImage.instances.length, 13);
  now++; render(); assert.equal(FakeImage.instances.length, 14);
  assert.equal(renderer.getStats().drawn, 0);
  FakeImage.instances[13].succeed();
  for (const callback of lateCallbacks) callback();
  assert.equal(renderer.getStats().failuresTotal, 2);
  assert.equal(renderer.getStats().failed, 0);
  assert.equal(renderer.getStats().baseFailed, 0);
  completeFrame(renderer, gl, view, fov, viewport);
});

test('exhausted root retries keep the entire layer off, even after long waits and new views', t => {
  const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxCacheTiles: 24,
    maxConcurrentLoads: 12, maxQueuedLoads: 12, maxRetries: 2, retryDelayMs: 100 });
  let now = 20000; t.mock.method(Date, 'now', () => now);
  const render = (step = 0) => renderer.render(lookAt(eq(step * 67, Math.sin(step) * 70)), perspective(70 * D, 1.8), 70 * D, [2380, 1294]);
  render();
  FakeImage.instances[0].fail();
  for (const image of FakeImage.instances.slice(1)) image.succeed();
  now += 100; render(); FakeImage.instances[12].fail();
  now += 200; render(); FakeImage.instances[13].fail();
  for (let step = 0; step < 30; step++) {
    now += 60000; render(step);
    assert.equal(renderer.getStats().baseFailed, 1);
    assert.equal(renderer.getStats().baseLoaded, 11);
    assert.equal(renderer.getStats().baseReady, false);
    assert.equal(renderer.getStats().drawn, 0);
    assert.equal(renderer.getStats().loading, 0);
    assert.equal(renderer.getStats().queued, 0);
  }
  assert.equal(renderer.getStats().requested, 14, 'exactly one initial request and two retries for the failed root');
  assert.equal(renderer.getStats().cached, 12);
  assert.equal(gl.draws.length, 0);
});

for (const failure of ['zero-size', 'upload', 'allocation'] as const) {
  test(`complete base remains gated when the last root has a ${failure} failure`, t => {
    const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxConcurrentLoads: 12, maxQueuedLoads: 12, maxRetries: 0 });
    const render = () => renderer.render(lookAt(eq(0, 0)), perspective(110 * D), 110 * D, [647, 647]);
    render();
    for (const image of FakeImage.instances.slice(0, 11)) image.succeed();
    if (failure === 'zero-size') FakeImage.instances[11].naturalWidth = 0;
    if (failure === 'upload') gl.uploadThrows = true;
    if (failure === 'allocation') gl.textureAllocationFails = true;
    FakeImage.instances[11].succeed(); render();
    assert.equal(renderer.getStats().baseLoaded, 11);
    assert.equal(renderer.getStats().baseReady, false);
    assert.equal(renderer.getStats().baseFailed, 1);
    assert.equal(gl.draws.length, 0);
    renderer.dispose(); gl.assertDisposed();
  });
}

for (const cache of [12, 24]) {
  test(`complete base remains pinned with cache ${cache}, bounded queues, DPR 1/2, FOV 110/70 and dragging`, t => {
    const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxOrder: 3,
      maxCacheTiles: cache, maxConcurrentLoads: 3, maxQueuedLoads: 4, maxVisibleTiles: 24, maxMeshTiles: 24, maxRetries: 0 });
    const bounds = () => {
      const s = renderer.getStats();
      assert.ok(s.cached <= cache); assert.ok(s.loaded <= cache); assert.ok(s.failed <= cache);
      assert.ok(s.loading <= 3); assert.ok(s.queued <= 4); assert.ok(s.meshes <= 24);
    };
    for (let frame = 0; frame < 12 && !renderer.getStats().baseReady; frame++) {
      renderer.render(lookAt(eq(0, 0)), perspective(70 * D), 70 * D, [647, 647]);
      bounds(); drainImages(); bounds();
    }
    assert.equal(renderer.getStats().baseReady, true);
    assert.equal(FakeImage.instances.length, 12);
    const roots = gl.created.filter(r => r.kind === 'texture');
    assert.equal(roots.length, 12);
    for (let step = 0; step < 20; step++) for (const dpr of [1, 2]) for (const degrees of [110, 70]) {
      completeFrame(renderer, gl, lookAt(eq(step * 67, Math.sin(step) * 70)), degrees * D, [1190 * dpr, 647 * dpr], 24);
      bounds();
      drainImages(step % 5 === 0 ? 'fail' : 'succeed');
      assert.equal(renderer.getStats().baseLoaded, 12);
      assert.equal(renderer.getStats().baseReady, true);
      assert.equal(renderer.getStats().baseFailed, 0);
      assert.ok(roots.every(root => !gl.deleted.includes(root)), 'no root texture may be evicted');
      bounds();
    }
    if (cache === 12) {
      assert.equal(renderer.getStats().requested, 12, 'full cache is allowed to remain root-only');
      assert.equal(gl.created.filter(r => r.kind === 'texture').length, 12);
    } else {
      assert.ok(gl.created.filter(r => r.kind === 'texture').length > cache, 'detail eviction was exercised');
      assert.ok(gl.deleted.some(r => r.kind === 'texture'));
    }
    renderer.dispose(); gl.assertDisposed();
  });
}

test('complete-base roots are pinned from creation, before any image has loaded', t => {
  const { manager } = fixture(t, { requireCompleteBase: true, maxCacheTiles: 12, maxConcurrentLoads: 1, maxQueuedLoads: 1 });
  const roots = Array.from({ length: 12 }, (_, pix) => manager.getTile(0, pix));
  for (let pix = 0; pix < 100; pix++) assert.equal(manager.getTile(3, pix).loaded, false);
  for (let pix = 0; pix < 12; pix++) assert.equal(manager.getTile(0, pix), roots[pix]);
  for (let frame = 0; frame < 12; frame++) {
    manager.requestTile(3, 222);
    drainImages();
    assert.ok(manager.getStats().loading <= 1); assert.ok(manager.getStats().queued <= 1);
    assert.equal(manager.getStats().cached, 12);
  }
  assert.equal(manager.getStats().baseReady, true);
  assert.equal(manager.getStats().requested, 12);
});

test('detail failures/timeouts and late callbacks preserve complete coverage, with exact/ancestor/root single draws', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxOrder: 3, maxCacheTiles: 96,
    maxConcurrentLoads: 2, maxQueuedLoads: 12, maxRetries: 0, loadTimeoutMs: 100 });
  const view = lookAt(eq(266.405, -28.936)), fov = 8 * D, viewport: [number, number] = [1190, 647];
  renderer.render(view, perspective(fov, viewport[0] / viewport[1]), fov, viewport); drainImages();
  assert.equal(renderer.getStats().baseReady, true);
  completeFrame(renderer, gl, view, fov, viewport);
  const allRootTextures = new Set(gl.created.filter(r => r.kind === 'texture'));
  let exact: FakeImage | undefined;
  for (let step = 0; step < 5 && !exact; step++) {
    // Load one ancestor branch until an actual selected detail leaf is available;
    // leave other branches pending so exact, ancestor and root fallback coexist.
    for (let i = 12; i < FakeImage.instances.length; i++) {
      const image = FakeImage.instances[i];
      if (!image.onload) continue;
      const tile = decodeUrl(image.src);
      if (tile.order === 3) { image.succeed(); exact = image; break; }
      image.succeed();
    }
    completeFrame(renderer, gl, view, fov, viewport);
  }
  assert.ok(exact, 'exercise an exact detail replacement');
  assert.ok(gl.draws.some(d => d.transform[2] === 1));
  assert.ok(gl.draws.some(d => d.transform[2] < 1));
  assert.ok(gl.draws.some(d => !allRootTextures.has(d.texture)));
  const pending = FakeImage.instances.filter(image => image.onload);
  assert.ok(pending.length > 1);
  const late = pending.flatMap(image => [image.onload!, image.onerror!]);
  pending[0].fail();
  t.mock.timers.tick(100);
  const failures = renderer.getStats().failuresTotal;
  assert.ok(failures >= 2, 'network failure and another detail timeout occurred');
  for (const callback of late) callback();
  assert.equal(renderer.getStats().failuresTotal, failures);
  assert.ok(renderer.getStats().detailFailed >= 2);
  completeFrame(renderer, gl, view, fov, viewport);
  assert.equal(renderer.getStats().baseFailed, 0);
  assert.ok([...allRootTextures].every(texture => !gl.deleted.includes(texture)));
});

for (const phase of ['pending-base', 'ready-with-details'] as const) {
  test(`complete-base dispose at ${phase} cancels timers/queue and late callbacks never revive resources`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxConcurrentLoads: 6, maxQueuedLoads: 12, loadTimeoutMs: 100 });
    const render = () => renderer.render(lookAt(eq(266.405, -28.936)), perspective(8 * D), 8 * D, [800, 800]);
    render();
    if (phase === 'pending-base') {
      for (let i = 0; i < FakeImage.instances.length; i++) if (decodeUrl(FakeImage.instances[i].src).pix !== 0) FakeImage.instances[i].succeed();
      assert.equal(renderer.getStats().baseLoaded, 11);
    } else { drainImages(); render(); assert.equal(renderer.getStats().baseReady, true); }
    const active = FakeImage.instances.filter(image => image.onload);
    assert.ok(active.length > 0);
    const late = active.flatMap(image => [image.onload!, image.onerror!]);
    renderer.dispose(); renderer.dispose();
    const created = gl.created.length, requested = FakeImage.instances.length;
    for (const callback of late) callback();
    t.mock.timers.tick(60000); renderer.init(); render();
    const stats = renderer.getStats();
    assert.equal(stats.baseReady, false); assert.equal(stats.baseLoaded, 0); assert.equal(stats.baseFailed, 0);
    assert.equal(stats.loaded, 0); assert.equal(stats.loading, 0); assert.equal(stats.queued, 0); assert.equal(stats.cached, 0);
    assert.equal(stats.drawn, 0); assert.equal(stats.meshes, 0);
    assert.equal(gl.created.length, created); assert.equal(FakeImage.instances.length, requested);
    assert.ok(active.every(image => !image.onload && !image.onerror && image.src === ''));
    gl.assertDisposed();
  });
}
