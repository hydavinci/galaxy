type AppHandle = { dispose(): void; readonly isDisposed: boolean };
type Mount = { abort: AbortController; app?: AppHandle };

/** One three-dimensional application. No alternate mode or observer import.
 * Retry owns the same abort/generation boundary as a fresh application mount. */
export class MainApp {
  private root = document.getElementById('mode-root')!;
  private style = document.getElementById('galaxy-mode-style')!;
  private recovery = document.getElementById('main-recovery')!;
  private retryButton = document.getElementById('main-retry')!;
  private notice = document.getElementById('main-status')!;
  private active?: Mount;
  private generation = 0;
  private disposed = false;
  private state: 'loading' | 'ready' | 'error' = 'loading';
  get status() { return this.state; }
  private retryClick = () => { void this.retry(); };
  private failure = (event: Event) => {
    if (this.disposed || !this.root.contains(event.target as Node)) return;
    this.active?.abort.abort(); this.active?.app?.dispose();
    this.state = 'error'; document.body.dataset.mainState = 'error';
    this.recovery.hidden = false; this.notice.hidden = false;
    this.notice.textContent = '三维场景暂时不可用，请重试。';
  };
  private pagehide = () => this.dispose();
  constructor() {
    this.retryButton.addEventListener('click', this.retryClick);
    this.root.addEventListener('galaxy-mode-error', this.failure);
    window.addEventListener('pagehide', this.pagehide);
  }
  async retry(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.active?.abort.abort(); this.active?.app?.dispose();
    const mount: Mount = { abort: new AbortController() }; this.active = mount;
    this.root.replaceChildren(); this.style.textContent = ''; delete this.style.dataset.mode;
    this.state = 'loading'; document.body.dataset.mainState = 'loading';
    this.recovery.hidden = true; this.notice.hidden = false;
    this.notice.textContent = '正在进入三维探索…';
    const current = () => !this.disposed && generation === this.generation && !mount.abort.signal.aborted;
    try {
      const [module, css, template] = await Promise.all([
        import('./space/app'), import('./space/style.css?inline'), import('./modes/space.html?raw'),
      ]);
      if (!current()) return;
      this.style.textContent = css.default; this.style.dataset.mode = 'space';
      this.root.innerHTML = template.default;
      const app = await module.startSpace(mount.abort.signal);
      if (!current()) { app?.dispose(); return; }
      mount.app = app;
      if (!app || app.isDisposed) throw new Error('三维场景暂时不可用，请重试。');
      this.state = 'ready'; document.body.dataset.mainState = 'ready';
      this.recovery.hidden = true; this.notice.hidden = true;
    } catch (error) {
      if (!current()) return;
      mount.abort.abort(); mount.app?.dispose();
      this.state = 'error'; document.body.dataset.mainState = 'error';
      this.recovery.hidden = false; this.notice.hidden = false;
      this.notice.textContent = error instanceof Error ? error.message : '三维场景启动失败，请重试。';
    }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; ++this.generation;
    this.active?.abort.abort(); this.active?.app?.dispose(); this.active = undefined;
    this.retryButton.removeEventListener('click', this.retryClick);
    window.removeEventListener('pagehide', this.pagehide);
    this.root.removeEventListener('galaxy-mode-error', this.failure);
    this.root.replaceChildren(); this.style.textContent = ''; delete this.style.dataset.mode;
    delete document.body.dataset.mainState;
    if ((window as any).__main === this) delete (window as any).__main;
  }
}

const main = new MainApp();
(window as any).__main = main;
void main.retry();
