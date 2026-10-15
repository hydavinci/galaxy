/** Independent, non-ephemeris globe. No Earth sky coordinates or startup GL work. */
import { PlanetTextureManager } from './planet-textures';

export const EARTH_TEXTURE_BUDGET = 64 * 1024 * 1024;
export const EARTH_MIN_ZOOM = .65;
export const EARTH_MAX_ZOOM = 4;
export interface EarthView { longitude: number; latitude: number; zoom: number; }
export const defaultEarthView = (): EarthView => ({ longitude: 140, latitude: 20, zoom: 1 });
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export function zoomEarth(view: EarthView, factor: number): void {
  if (Number.isFinite(factor) && factor > 0) view.zoom = clamp(view.zoom * factor, EARTH_MIN_ZOOM, EARTH_MAX_ZOOM);
}
export function rotateEarth(view: EarthView, dx: number, dy: number, shortSide: number): void {
  if (![dx, dy, shortSide].every(Number.isFinite)) return;
  const degrees = 180 / Math.max(1, shortSide) / view.zoom;
  view.longitude = ((view.longitude - dx * degrees + 180) % 360 + 360) % 360 - 180;
  view.latitude = clamp(view.latitude + dy * degrees, -89.5, 89.5);
}
/** Column-major view-to-geographic basis. +Y north; atan(z,x) = longitude. */
export function earthRotation(view: EarthView): Float32Array {
  const lon = view.longitude * Math.PI / 180, lat = view.latitude * Math.PI / 180;
  const c = Math.cos(lon), s = Math.sin(lon), a = Math.cos(lat), b = Math.sin(lat);
  return new Float32Array([-s, 0, c, -b*c, a, -b*s, a*c, b, a*s]);
}
/** Isotropic orthographic radius in framebuffer pixels, independent of aspect. */
export function earthRadius(width: number, height: number, zoom: number): number {
  return Math.max(1, Math.min(width, height)) * .4 * clamp(zoom, EARTH_MIN_ZOOM, EARTH_MAX_ZOOM);
}
export const EARTH_VERTEX_SHADER = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
/** Native validation interface: fullscreen triangle (gl_VertexID 0..2), no
 * attributes. uViewport vec2 framebuffer size, uRadius float pixels,
 * uRotation mat3 column-major earthRotation(), uDaymap sampler2D unit 0,
 * uReady bool. JPEG uploaded WITHOUT FLIP_Y: north is texture v=0.
 * Light is deliberately fixed in view space, NOT derived from simulation time. */
export const EARTH_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec2 uViewport;
uniform float uRadius;
uniform mat3 uRotation;
uniform sampler2D uDaymap;
uniform bool uReady;
out vec4 outColor;
void main() {
  vec2 p = (gl_FragCoord.xy - uViewport * 0.5) / uRadius;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r2)));
  vec3 geographic = normalize(uRotation * n);
  vec2 uv = vec2(atan(geographic.z, geographic.x) / 6.28318530718 + 0.5,
                 0.5 - asin(clamp(geographic.y, -1.0, 1.0)) / 3.14159265359);
  // atan wraps longitude at the dateline. Its apparent U jump must not select
  // a coarse mip and paint a bright stripe when the seam crosses a pixel quad.
  // Latitude is not periodic: keep its ordinary derivative unchanged.
  vec2 uvDx = dFdx(uv), uvDy = dFdy(uv);
  uvDx.x -= round(uvDx.x); uvDy.x -= round(uvDy.x);
  vec3 surface = uReady ? textureGrad(uDaymap, uv, uvDx, uvDy).rgb : vec3(0.12, 0.18, 0.25);
  float light = 0.28 + 0.72 * max(0.0, dot(n, normalize(vec3(-0.4, 0.6, 1.0))));
  outColor = vec4(surface * light, 1.0);
}`;

export class EarthRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly textures: PlanetTextureManager;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private placeholder: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private disposed = false;
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('此设备未提供 WebGL2，无法显示地球仪');
    this.gl = gl;
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, EARTH_VERTEX_SHADER], [gl.FRAGMENT_SHADER, EARTH_FRAGMENT_SHADER]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('无法分配地球着色器');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('地球着色器编译失败');
      }
      this.program = gl.createProgram();
      if (!this.program) throw new Error('无法分配地球图形程序');
      for (const shader of shaders) gl.attachShader(this.program, shader);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('地球图形程序链接失败');
      this.vao = gl.createVertexArray(); this.placeholder = gl.createTexture();
      if (!this.vao || !this.placeholder) throw new Error('无法分配地球图形资源');
      gl.bindTexture(gl.TEXTURE_2D, this.placeholder);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const key of ['uViewport', 'uRadius', 'uRotation', 'uDaymap', 'uReady']) this.uniforms[key] = gl.getUniformLocation(this.program, key);
      // Always conservative: <=4K, <=64MiB texture mip chains, independently
      // of the sky's capabilities/budget. No changes to other bodies' tiers.
      this.textures = new PlanetTextureManager(gl, { mobile: true, gpuBudgetBytes: EARTH_TEXTURE_BUDGET });
    } catch (error) {
      this.deleteResources(); gl.getExtension('WEBGL_lose_context')?.loseContext(); throw error;
    } finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  render(view: EarthView, now: number): string {
    if (this.disposed || this.gl.isContextLost()) throw new Error('地球图形上下文已中断，请关闭并重新打开');
    const gl = this.gl, canvas = this.canvas;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    const scale = Math.min(window.devicePixelRatio || 1, 2, 2048 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const radius = earthRadius(w, h, view.zoom);
    this.textures.update({ azimuthDeg: view.longitude, altitudeDeg: view.latitude, fovDeg: 60 / view.zoom },
      [{ id: 'earth', devicePixelDiameter: radius * 2, screenPosition: [0, 0] }], now);
    const ready = this.textures.get('earth'), stats = this.textures.getStats();
    gl.viewport(0, 0, w, h); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.clearColor(.015, .025, .045, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program); gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uniforms.uViewport, w, h); gl.uniform1f(this.uniforms.uRadius, radius);
    gl.uniformMatrix3fv(this.uniforms.uRotation, false, earthRotation(view));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ready?.texture ?? this.placeholder);
    gl.uniform1i(this.uniforms.uDaymap, 0); gl.uniform1i(this.uniforms.uReady, ready ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (stats.contextLost) throw new Error('地球图形上下文已中断，请关闭并重新打开');
    if (ready) return `地球日间贴图 · ${ready.tier}K${stats.failuresTotal ? ' · 部分贴图请求失败，保留已载入贴图' : stats.hdLoading ? ' · 正在载入更多细节' : ''}`;
    if (stats.maxTextureSize < 2048) return '此设备不支持 2K 地球贴图；当前底色球为占位，可返回星空';
    if (stats.failed) return '地球贴图加载失败；当前底色球为占位。请关闭并重新打开以重试';
    return stats.failuresTotal ? '地球贴图暂不可用，正在有限重试；底色球为占位' : '正在载入地球贴图；底色球为占位';
  }
  contextLost(): void { this.textures.contextLost(); }
  private deleteResources(): void {
    const gl = this.gl;
    if (!gl.isContextLost()) {
      if (this.placeholder) gl.deleteTexture(this.placeholder);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.placeholder = null; this.vao = null; this.program = null;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.textures.dispose(); this.deleteResources();
    // Release the independent context as well as GL objects on every close.
    if (!this.gl.isContextLost()) this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** One controller per opening; listeners, canvas, RAF and renderer die together. */
export class EarthInspector {
  private renderer?: EarthRenderer;
  private frame = 0;
  private disposed = false;
  private cleanup: Array<() => void> = [];
  private points = new Map<number, { x: number; y: number }>();
  private view = defaultEarthView();
  readonly canvas: HTMLCanvasElement;
  constructor(private dialog: HTMLDialogElement, private onClose: () => void, private returnFocus: HTMLElement) {
    const canvas = document.createElement('canvas'); this.canvas = canvas;
    canvas.id = 'earth-canvas'; canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '地球仪：拖动旋转，滚轮或双指缩放；方向键旋转，加减键缩放，R 重置，Esc 返回星空');
    canvas.setAttribute('aria-describedby', 'earth-help earth-status');
    dialog.querySelector('#earth-stage')!.replaceChildren(canvas);
    const listen = (target: EventTarget, name: string, fn: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(name, fn, options); this.cleanup.push(() => target.removeEventListener(name, fn, options));
    };
    const close = () => { if (dialog.open) dialog.close(); this.dispose(); };
    listen(dialog, 'close', () => { if (!dialog.open) this.dispose(); });
    listen(dialog, 'cancel', e => { e.preventDefault(); close(); });
    listen(dialog, 'keydown', (event) => {
      const e = event as KeyboardEvent;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button,canvas[tabindex],a[href]'));
        const first = focusable[0], last = focusable[focusable.length-1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault(); e.stopPropagation();
        rotateEarth(this.view, e.key === 'ArrowRight' ? -20 : e.key === 'ArrowLeft' ? 20 : 0,
          e.key === 'ArrowUp' ? 20 : e.key === 'ArrowDown' ? -20 : 0, 360);
      } else if (['+', '=', '-', '_', 'r', 'R', '0', 'Home'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        if (['r', 'R', '0', 'Home'].includes(e.key)) this.view = defaultEarthView();
        else zoomEarth(this.view, ['+', '='].includes(e.key) ? 1.25 : .8);
      }
    });
    listen(dialog, 'click', event => {
      if (event.target !== dialog) return;
      const e = event as MouseEvent, r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });
    for (const id of ['earth-close', 'earth-back']) listen(dialog.querySelector(`#${id}`)!, 'click', close);
    listen(dialog.querySelector('#earth-plus')!, 'click', () => zoomEarth(this.view, 1.25));
    listen(dialog.querySelector('#earth-minus')!, 'click', () => zoomEarth(this.view, .8));
    listen(dialog.querySelector('#earth-reset')!, 'click', () => { this.view = defaultEarthView(); });
    listen(canvas, 'pointerdown', event => {
      const e = event as PointerEvent;
      if (e.button !== 0 || this.points.has(e.pointerId)) return;
      canvas.focus(); this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* detached test/input client */ }
    });
    listen(canvas, 'pointermove', event => {
      const e = event as PointerEvent, old = this.points.get(e.pointerId);
      if (!old) return;
      const before = this.distance(); this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.points.size === 2) { const after = this.distance(); if (before > 0 && after > 0) zoomEarth(this.view, after / before); }
      else if (this.points.size === 1) rotateEarth(this.view, e.clientX-old.x, e.clientY-old.y, Math.min(canvas.clientWidth, canvas.clientHeight));
    });
    const end = (event: Event) => {
      const e = event as PointerEvent;
      this.points.delete(e.pointerId);
      try { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch { /* best effort */ }
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, type, end);
    listen(canvas, 'wheel', event => { const e = event as WheelEvent; e.preventDefault(); zoomEarth(this.view, Math.exp(-clamp(e.deltaY, -200, 200)*.002)); }, { passive: false });
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault(); cancelAnimationFrame(this.frame); this.renderer?.contextLost();
      this.status('地球图形上下文已中断，请关闭并重新打开；原星空不受影响', true);
    });
    listen(window, 'blur', () => this.clearPointers());
  }
  open(): void {
    this.dialog.showModal(); this.canvas.focus();
    this.status('正在准备独立地球仪…');
    try { this.renderer = new EarthRenderer(this.canvas); this.frame = requestAnimationFrame(this.draw); }
    catch (error) { this.status(`${error instanceof Error ? error.message : String(error)}。可返回星空后重试`, true); }
  }
  private distance(): number { const p = [...this.points.values()]; return p.length === 2 ? Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y) : 0; }
  private status(message: string, error = false): void {
    const el = this.dialog.querySelector<HTMLElement>('#earth-status')!;
    if (el.textContent !== message) el.textContent = message;
    el.dataset.error = String(error);
  }
  private draw = (now: number): void => {
    if (this.disposed || !this.dialog.open) return;
    try { if (!document.hidden) this.status(this.renderer!.render(this.view, now)); }
    catch (error) { this.status(error instanceof Error ? error.message : String(error), true); return; }
    this.frame = requestAnimationFrame(this.draw);
  };
  private clearPointers(): void {
    const ids = [...this.points.keys()]; this.points.clear();
    for (const id of ids) { try { if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id); } catch {} }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame);
    for (const remove of this.cleanup.splice(0)) remove();
    this.clearPointers(); this.renderer?.dispose(); this.renderer = undefined; this.canvas.remove();
    this.onClose(); if (this.returnFocus.isConnected) this.returnFocus.focus();
  }
}
