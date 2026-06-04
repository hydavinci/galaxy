export class HUD {
  constructor(private el: HTMLElement) {}
  update(text: string) { this.el.innerHTML = text; }
}
