import { Camera } from './camera';

export class Input {
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private touchDist = 0;

  constructor(private canvas: HTMLCanvasElement, private camera: Camera) {
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('mouseup', () => this.onMouseUp());
    canvas.addEventListener('mouseleave', () => this.onMouseUp());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.camera.zoom(e.deltaY, e.clientX, e.clientY, canvas.clientWidth, canvas.clientHeight); }, { passive: false });

    canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    canvas.addEventListener('touchend', () => this.dragging = false);
  }

  private onMouseDown(e: MouseEvent) {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.camera.stopInertia();
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    const scale = this.camera.fov / this.canvas.clientHeight;
    this.camera.rotate(-dx * scale, -dy * scale);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private onMouseUp() { this.dragging = false; }

  private onTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.dragging = true;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this.camera.stopInertia();
    } else if (e.touches.length === 2) {
      this.touchDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1 && this.dragging) {
      const dx = e.touches[0].clientX - this.lastX;
      const dy = e.touches[0].clientY - this.lastY;
      const scale = this.camera.fov / this.canvas.clientHeight;
      this.camera.rotate(-dx * scale, -dy * scale);
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      const delta = this.touchDist - dist;
      this.camera.zoom(delta * 3);
      this.touchDist = dist;
    }
  }
}
