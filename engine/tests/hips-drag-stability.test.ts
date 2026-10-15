import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ancestorTextureTransform, ang2pixNested, galacticToEquatorial } from '../src/hips/healpix';
import { chooseOrder, getVisibleTiles, type VisibleTile } from '../src/hips/visibility';
import type { HipsConfig } from '../src/hips/tile-manager';
const sourceRoot = process.env.HIPS_BASELINE_ROOT || fileURLToPath(new URL('../src/', import.meta.url));
const { HipsRenderer, buildTileMeshData } = await import(pathToFileURL(resolve(sourceRoot, 'hips/hips-renderer.ts')).href);
const { HipsTileManager } = await import(pathToFileURL(resolve(sourceRoot, 'hips/tile-manager.ts')).href);
const measureOnly = !!process.env.HIPS_MEASURE_ONLY;
const evidence: Record<string, unknown> = {};
// Actual source render/loader through controlled Image and stateful GL protocol.
// No context, network, rasterization, browser paint or timing claims.
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
    this.draws.push({ vao: this.params.get(this.VERTEX_ARRAY_BINDING), texture: this.bindings.get(this.params.get(this.ACTIVE_TEXTURE))!, transform: this.uniforms.get('u_texTransform').slice(), count });
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

function workSample(gl: FakeGL, run: () => void) {
  const originalSort = Array.prototype.sort, originalParameter = gl.getParameter;
  let sorts = 0, reads = 0;
  Array.prototype.sort = function(compare: any) { sorts++; return originalSort.call(this, compare); };
  gl.getParameter = function(p: number) { reads++; return originalParameter.call(this, p); };
  const before = gl.created.length, requested = FakeImage.instances.length;
  try { run(); } finally { Array.prototype.sort = originalSort; gl.getParameter = originalParameter; }
  return { sorts, reads, resources: gl.created.length - before, requests: FakeImage.instances.length - requested };
}
function recordUploads(gl: FakeGL) {
  const uploads = new Map<Resource, ReturnType<typeof decodeUrl>>();
  gl.texImage2D = (...args: any[]) => {
    if (gl.uploadThrows) throw new Error('mock upload failure');
    uploads.set(gl.bindings.get(gl.params.get(gl.ACTIVE_TEXTURE))!, decodeUrl(args[args.length - 1].src));
  };
  return uploads;
}

test('stationary pending and resident views avoid repeated closure/visibility/sort work without changing draws', t => {
  const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxOrder: 3,
    maxCacheTiles: 64, maxConcurrentLoads: 3, maxQueuedLoads: 32, maxMeshTiles: 128, maxVisibleTiles: 96 });
  const view = lookAt(eq(266.4, -28.9)), fov = 8 * D, proj = perspective(fov, 1.5);
  const frame = () => { gl.draws = []; renderer.render(view.slice(), proj.slice(), fov, [1200, 800]); };
  frame();
  const pending = workSample(gl, () => { for (let i = 0; i < 300; i++) { frame(); assert.equal(gl.draws.length, 0); } });
  assert.equal(pending.requests, 0);
  for (let i = 0; i < 12; i++) { drainImages(); frame(); }
  const warmedRequests = FakeImage.instances.length;
  const warmedSignature = JSON.stringify(gl.draws);
  const completedResident = workSample(gl, () => { for (let i = 0; i < 80; i++) {
    drainImages(); frame(); assert.equal(JSON.stringify(gl.draws), warmedSignature);
  } });
  const completedResidentRequestOrders: Record<string, number> = {};
  const requestedUrls = FakeImage.instances.slice(warmedRequests).map(image => image.src);
  for (const url of requestedUrls) {
    const order = decodeUrl(url).order;
    completedResidentRequestOrders[order] = (completedResidentRequestOrders[order] ?? 0) + 1;
  }
  const signature = JSON.stringify(gl.draws);
  const resident = workSample(gl, () => {
    for (let i = 0; i < 300; i++) { frame(); assert.equal(JSON.stringify(gl.draws), signature); }
  });
  assert.equal(resident.requests, 0); assert.equal(resident.resources, 0);
  assert.equal(resident.reads, 6 * 300, 'state-preserving boundary is intentionally retained');
  if (!measureOnly) {
    assert.equal(pending.sorts, 0); assert.equal(resident.sorts, 0);
    assert.equal(completedResident.requests, 0); assert.equal(completedResident.resources, 0);
  }
  evidence.stationary = { framesPerPhase: 300, pending, warmedRequests, completedResidentFrames: 80,
    completedResident, completedResidentRequestOrders, distinctRequestedUrls: new Set(requestedUrls).size,
    resident, stats: renderer.getStats(), textureAlternations: 0 };
});

test('unchanged views still invalidate on retry deadline and progress after completion', t => {
  const { manager, gl } = fixture(t, { requireCompleteBase: true, maxConcurrentLoads: 12,
    maxRetries: 1, retryDelayMs: 100 });
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const leaves = [{ order: 3, pix: 100, priority: .7 }];
  manager.updateVisibleTiles(leaves);
  FakeImage.instances[0].fail();
  FakeImage.instances.slice(1).forEach(image => image.succeed());
  manager.updateVisibleTiles(leaves); assert.equal(manager.getStats().baseLoaded, 11);
  now += 99; manager.updateVisibleTiles(leaves); assert.equal(FakeImage.instances.length, 12);
  now++; manager.updateVisibleTiles(leaves); assert.equal(FakeImage.instances.length, 13);
  FakeImage.instances[12].succeed(); manager.updateVisibleTiles(leaves);
  assert.equal(manager.getStats().baseReady, true);
  drainImages(); manager.updateVisibleTiles(leaves);
  assert.equal(manager.getTileOrAncestor(3, 100, false)?.order, 3);
  // Mutable arrays and rank changes are not mistaken for unchanged views.
  leaves[0] = { order: 3, pix: 600, priority: .3 };
  manager.updateVisibleTiles(leaves); drainImages(); manager.updateVisibleTiles(leaves);
  assert.equal(manager.getTileOrAncestor(3, 600, false)?.order, 3);
  manager.updateVisibleTiles(leaves);
  const settledPriorities = workSample(gl, () => {
    for (let i = 0; i < 300; i++) { leaves[0].priority = .3 + i / 1000; manager.updateVisibleTiles(leaves); }
  });
  assert.equal(settledPriorities.requests, 0);
  if (!measureOnly) assert.equal(settledPriorities.sorts, 0);
  evidence.settledPriorityChanges = { updates: 300, ...settledPriorities };
});

test('delayed out-of-order images through reversing fast pans preserve atomic roots and one current-camera sample per leaf', t => {
  const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxOrder: 3,
    maxCacheTiles: 24, maxConcurrentLoads: 3, maxQueuedLoads: 8, maxMeshTiles: 24, maxVisibleTiles: 24, maxRetries: 0 });
  const uploads = recordUploads(gl);
  const protocol = createHash('sha256');
  let readyFrames = 0, gatedFrames = 0, fallbackFrames = 0, failures = 0, drawChecks = 0;
  let maxCached = 0, maxLoading = 0, maxQueued = 0, maxMeshes = 0;
  for (let i = 0; i < 180; i++) {
    const longitude = (i < 90 ? i : 180 - i) * 19;
    const view = lookAt(eq(longitude, Math.sin(i / 17) * 85));
    const fov = (i % 3 === 0 ? 4 : i % 3 === 1 ? 25 : 110) * D;
    const vp: [number, number] = i % 2 ? [1600, 1000] : [600, 1000];
    const proj = perspective(fov, vp[0] / vp[1]);
    gl.draws = []; renderer.render(view, proj, fov, vp);
    const stats = renderer.getStats();
    protocol.update(JSON.stringify({ i, view: [...view], proj: [...proj], baseReady: stats.baseReady,
      targetOrder: stats.targetOrder, visible: stats.visible, opacity: gl.uniforms.get('u_opacity') }));
    maxCached = Math.max(maxCached, stats.cached); maxLoading = Math.max(maxLoading, stats.loading);
    maxQueued = Math.max(maxQueued, stats.queued); maxMeshes = Math.max(maxMeshes, stats.meshes);
    assert.ok(stats.cached <= 24 && stats.loading <= 3 && stats.queued <= 8 && stats.meshes <= 24);
    if (!stats.baseReady) { gatedFrames++; assert.equal(gl.draws.length, 0); }
    else {
      readyFrames++; if (stats.fallbackDrawn) fallbackFrames++;
      const leaves = getVisibleTiles(stats.targetOrder, view, proj, fov, 'galactic', 24);
      noOverlappingLeaves(leaves); assert.equal(gl.draws.length, leaves.length);
      assert.deepEqual(gl.uniforms.get('u_viewMatrix'), view);
      assert.deepEqual(gl.uniforms.get('u_projMatrix'), proj);
      for (let j = 0; j < leaves.length; j++) {
        const leaf = leaves[j], draw = gl.draws[j], source = uploads.get(draw.texture)!;
        assert.ok(source); assert.ok(!gl.deleted.includes(draw.texture));
        assert.equal(Math.floor(leaf.pix / 4 ** (leaf.order - source.order)), source.pix);
        assert.deepEqual(draw.transform, ancestorTextureTransform(leaf.order, leaf.pix, source.order));
        assert.deepEqual(gl.data.get(gl.vaoBuffers.get(draw.vao)!), buildTileMeshData(leaf.order, leaf.pix, 'galactic').vertices);
        protocol.update(JSON.stringify({ leaf, source, transform: draw.transform, count: draw.count }));
        protocol.update(Buffer.from(gl.data.get(gl.vaoBuffers.get(draw.vao)!)!.buffer));
        drawChecks++;
      }
    }
    if (i % 2 === 0) {
      const pending = FakeImage.instances.filter(image => image.onload);
      const image = pending[pending.length - 1];
      if (image) {
        if (decodeUrl(image.src).order > 0 && i % 10 === 0) { image.fail(); failures++; }
        else image.succeed();
      }
    }
  }
  assert.ok(gatedFrames > 10 && readyFrames > 50 && fallbackFrames > 0 && failures > 0);
  evidence.fastPan = { frames: 180, readyFrames, gatedFrames, fallbackFrames, failures, drawChecks,
    maxCached, maxLoading, maxQueued, maxMeshes, protocolSHA256: protocol.digest('hex'), stats: renderer.getStats() };
  renderer.dispose(); gl.assertDisposed();
});

test('current visible meshes survive LRU pressure before their draw, including reversed order and quality changes', t => {
  const { renderer, gl } = rendererFixture(t, { requireCompleteBase: true, maxOrder: 3,
    maxCacheTiles: 12, maxConcurrentLoads: 3, maxQueuedLoads: 8, maxMeshTiles: 24, maxVisibleTiles: 24, tileSize: 64 });
  const primeView = lookAt(eq(0, 0)), fov = 100 * D, proj = perspective(fov, 1.6);
  for (let i = 0; i < 3; i++) { renderer.render(primeView, proj, fov, [1600, 1000]); drainImages(); }
  assert.equal(renderer.getStats().baseReady, true);
  let builds = 0, unavoidableBuilds = 0, draws = 0;
  for (let i = 0; i < 150; i++) {
    const view = lookAt(eq(i < 75 ? i * .7 : (150 - i) * .7, 20));
    const leaves = getVisibleTiles(3, view, proj, fov, 'galactic', 24);
    const prior = new Set((renderer as any).meshCache.keys());
    const misses = leaves.filter(leaf => !prior.has(`${leaf.order}/${leaf.pix}/12`)).length;
    const before = gl.created.filter(r => r.kind === 'vao').length;
    gl.draws = []; renderer.render(view, proj, fov, [1600, 1000]);
    const count = gl.created.filter(r => r.kind === 'vao').length - before;
    builds += count; unavoidableBuilds += misses; draws += gl.draws.length;
    if (!measureOnly) assert.equal(count, misses, 'no cached current leaf is evicted before being drawn');
  }
  evidence.meshPan = { frames: 150, builds, unavoidableBuilds, excessBuilds: builds - unavoidableBuilds, draws };
  // All original refraction quality modes still allocate exactly their mesh size;
  // returning to a quality may rebuild, but remains within the same mesh budget.
  const modes = [];
  for (const degrees of [40, 10, 2, 10, 40]) {
    const f = degrees * D, p = perspective(f, 1.6), segments = degrees < 5 ? 64 : degrees < 25 ? 24 : 12;
    gl.draws = []; renderer.render(primeView, p, f, [1600, 1000],
      { refraction: true, horizontalView: primeView, equatorialToHorizontal: identity() });
    for (const draw of gl.draws) assert.equal(draw.count, segments * segments * 6);
    assert.ok(renderer.getStats().meshes <= 24);
    modes.push({ degrees, segments, draws: gl.draws.length, indicesPerDraw: segments * segments * 6 });
  }
  evidence.qualityProtocol = modes;
  renderer.dispose(); gl.assertDisposed();
});

test('write optional reproducible source protocol measurements', () => {
  if (process.env.HIPS_EVIDENCE_PATH) writeFileSync(process.env.HIPS_EVIDENCE_PATH,
    JSON.stringify({ sourceRoot, measureOnly, kind: 'CPU + stateful GL protocol; no pixels/FPS', ...evidence }, null, 2) + '\n');
});
