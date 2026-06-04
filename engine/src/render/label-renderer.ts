import { Camera } from '../core/camera';

interface NamedStar {
  name: string;
  ra: number;
  dec: number;
  mag: number;
  bv?: number;
}

export class LabelRenderer {
  private stars: NamedStar[] = [];
  private container: HTMLElement;
  private labels: HTMLElement[] = [];
  private camera!: Camera;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'star-labels';
    this.container.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    document.getElementById('canvas-container')!.appendChild(this.container);
  }

  async init(camera: Camera) {
    this.camera = camera;
    const resp = await fetch('./data/named-stars.json');
    this.stars = await resp.json();
    // Only label stars brighter than mag 4
    this.stars = this.stars.filter(s => s.mag < 4.0);
    
    // Pre-create label elements
    for (const star of this.stars) {
      const el = document.createElement('span');
      el.textContent = star.name;
      el.className = 'star-label';
      el.dataset.star = star.name;
      el.style.cssText = `position:absolute;font-size:11px;color:rgba(200,210,230,0.8);white-space:nowrap;transform:translate(6px,-50%);pointer-events:auto;cursor:pointer;`;
      this.container.appendChild(el);
      this.labels.push(el);
    }
  }

  render(view: Float32Array, proj: Float32Array, width: number, height: number) {
    const fovDeg = this.camera.fov * 180 / Math.PI;
    // Show more labels when zoomed in
    const magLimit = fovDeg > 80 ? 1.5 : fovDeg > 50 ? 2.5 : fovDeg > 30 ? 3.5 : 4.0;

    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      const el = this.labels[i];

      if (star.mag > magLimit) {
        el.style.display = 'none';
        continue;
      }

      // Project star position to screen
      const ra = star.ra;
      const dec = star.dec;
      const x = Math.cos(dec) * Math.cos(ra);
      const y = Math.sin(dec);
      const z = Math.cos(dec) * Math.sin(ra);

      // Apply view matrix
      const vx = view[0]*x + view[4]*y + view[8]*z;
      const vy = view[1]*x + view[5]*y + view[9]*z;
      const vz = view[2]*x + view[6]*y + view[10]*z;

      // Behind camera
      if (vz > 0) {
        el.style.display = 'none';
        continue;
      }

      // Apply projection
      const px = proj[0]*vx + proj[4]*vy + proj[8]*vz + proj[12];
      const py = proj[1]*vx + proj[5]*vy + proj[9]*vz + proj[13];
      const pw = proj[3]*vx + proj[7]*vy + proj[11]*vz + proj[15];

      const ndcX = px / pw;
      const ndcY = py / pw;

      if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) {
        el.style.display = 'none';
        continue;
      }

      const screenX = (ndcX * 0.5 + 0.5) * width;
      const screenY = (1.0 - (ndcY * 0.5 + 0.5)) * height;

      el.style.display = '';
      el.style.left = screenX + 'px';
      el.style.top = screenY + 'px';
    }
  }

  getNamedStars() {
    return this.stars;
  }
}
