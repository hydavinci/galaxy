/** Per-mount lifetime. Aborting also settles optional catalog loaders even if a
 * fetch implementation ignores its signal; late response bodies cannot revive UI. */
export function lifetimeFetch(signal: AbortSignal): typeof fetch {
  return ((input: RequestInfo | URL, options?: RequestInit) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const sources = [signal, options?.signal].filter((s): s is AbortSignal => !!s);
    for (const source of sources) {
      if (source.aborted) abort();
      else source.addEventListener('abort', abort, { once: true });
    }
    const cleanup = () => { for (const source of sources) source.removeEventListener('abort', abort); };
    const race = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      const cancelled = () => reject(new DOMException('Mode disposed', 'AbortError'));
      if (controller.signal.aborted) { cancelled(); void work.catch(() => {}); return; }
      controller.signal.addEventListener('abort', cancelled, { once: true });
      work.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', cancelled));
    });
    return race(Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('Mode disposed', 'AbortError');
      return fetch(input, { ...options, signal: controller.signal });
    })).then(response => {
      if (!response.ok) cleanup();
      // Keep the signal linked through body consumption, not just response headers.
      return new Proxy(response, { get(target, key) {
        if (key === 'json' || key === 'arrayBuffer') return () => race(target[key]()).finally(cleanup);
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }, error => { cleanup(); throw error; });
  }) as typeof fetch;
}

/** Release the renderer's EXISTING context, never canvas.getContext() (which
 * could accidentally allocate one on an already failed/unmounted canvas).
 * Both renderers own a private `gl`; keep this lifecycle-only adapter here so
 * mode integration does not alter their rendering/scientific implementations. */
export function disposeRenderer(renderer: { dispose(): void }): void {
  const gl = (renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
  try { renderer.dispose(); }
  finally { if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}
