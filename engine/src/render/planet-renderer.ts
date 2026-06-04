import { PlanetData } from '../astro/planets';
import { PlanetSphereRenderer } from './planet-sphere-renderer';
import planetVert from './shaders/planet.vert.glsl';
import planetFrag from './shaders/planet.frag.glsl';

// Planet visual magnitudes (approximate, for point size)
export const PLANET_POINT_SIZE: Record<string, number> = {
  Sun: 180,
  Moon: 80,
  Venus: 50,
  Jupiter: 45,
  Mars: 35,
  Saturn: 25,
  Mercury: 20,
  Uranus: 12,
  Neptune: 10,
  Earth: 30,
};

// Planet angular diameters (radians) for sphere rendering
export const PLANET_ANGULAR_SIZE: Record<string, number> = {
  Moon: 0.009,
  Sun: 0.009,
  Jupiter: 0.004,
  Saturn: 0.003,
  Mars: 0.002,
  Venus: 0.003,
  Mercury: 0.001,
  Uranus: 0.001,
  Neptune: 0.001,
  Earth: 0.003,
};

export class PlanetRenderer {
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private planets: PlanetData[] = [];
  private container: HTMLElement;
  private labels: HTMLElement[] = [];
  private locs: Record<string, WebGLUniformLocation> = {};
  private sphereRenderer!: PlanetSphereRenderer;

  // Sun position (updated with planets)
  private sunRA = 0;
  private sunDec = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.container = document.getElementById('star-labels') || document.createElement('div');
  }

  init() {
    const gl = this.gl;
    this.program = this.createProgram(planetVert, planetFrag);
    this.locs = {
      u_viewMatrix: gl.getUniformLocation(this.program, 'u_viewMatrix')!,
      u_projMatrix: gl.getUniformLocation(this.program, 'u_projMatrix')!,
      u_color: gl.getUniformLocation(this.program, 'u_color')!,
      u_size: gl.getUniformLocation(this.program, 'u_size')!,
    };

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const aPos = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.sphereRenderer = new PlanetSphereRenderer(gl);
    this.sphereRenderer.init();
  }

  updatePlanets(planets: PlanetData[]) {
    this.planets = planets;
    // Track Sun position for lighting
    const sun = planets.find(p => p.name === 'Sun');
    if (sun) {
      this.sunRA = sun.ra;
      this.sunDec = sun.dec;
    }
    // Remove old labels
    for (const el of this.labels) el.remove();
    this.labels = [];
    // Create new labels
    for (const p of planets) {
      const el = document.createElement('span');
      el.textContent = p.name;
      el.className = 'planet-label';
      el.dataset.planet = p.name;
      el.style.cssText = `position:absolute;font-size:12px;font-weight:bold;color:${p.color};white-space:nowrap;transform:translate(8px,-50%);pointer-events:auto;cursor:pointer;`;
      this.container.appendChild(el);
      this.labels.push(el);
    }
  }

  render(view: Float32Array, proj: Float32Array, width: number, height: number, fov?: number) {
    const gl = this.gl;
    const currentFov = fov || Math.PI / 3;
    // Blend factor: 0 = point only, 1 = sphere only
    // Based on screen size of the planet sphere
    const pixelsPerRad = height / currentFov;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locs.u_viewMatrix, false, view);
    gl.uniformMatrix4fv(this.locs.u_projMatrix, false, proj);

    gl.bindVertexArray(this.vao);

    for (let i = 0; i < this.planets.length; i++) {
      const p = this.planets[i];
      const ra = p.ra, dec = p.dec;
      const x = Math.cos(dec) * Math.cos(ra);
      const y = Math.sin(dec);
      const z = Math.cos(dec) * Math.sin(ra);

      const angSize = PLANET_ANGULAR_SIZE[p.name] || 0.001;
      const screenPx = angSize * pixelsPerRad;
      const hasTex = this.sphereRenderer.hasTexture(p.name) && this.sphereRenderer.textureReady(p.name);

      // Smooth transition: point fades out as sphere gets bigger
      // Below 4px: point only. 4-12px: blend. Above 12px: sphere only.
      const sphereAlpha = hasTex ? Math.min(Math.max((screenPx - 4) / 8, 0), 1) : 0;
      const pointAlpha = 1.0 - sphereAlpha;

      if (sphereAlpha > 0.01) {
        this.sphereRenderer.renderPlanet(p, view, proj, currentFov, this.sunRA, this.sunDec, sphereAlpha, angSize);
      }

      if (pointAlpha > 0.01) {
        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.locs.u_viewMatrix, false, view);
        gl.uniformMatrix4fv(this.locs.u_projMatrix, false, proj);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x, y, z]), gl.DYNAMIC_DRAW);
        const col = this.parseColor(p.color);
        gl.uniform4f(this.locs.u_color, col[0], col[1], col[2], pointAlpha);
        gl.uniform1f(this.locs.u_size, PLANET_POINT_SIZE[p.name] || 8);
        gl.drawArrays(gl.POINTS, 0, 1);
      }

      // Update label position
      const el = this.labels[i];
      if (!el) continue;

      const vx = view[0]*x + view[4]*y + view[8]*z;
      const vy = view[1]*x + view[5]*y + view[9]*z;
      const vz = view[2]*x + view[6]*y + view[10]*z;

      if (vz > 0) { el.style.display = 'none'; continue; }

      const px2 = proj[0]*vx + proj[4]*vy + proj[8]*vz + proj[12];
      const py2 = proj[1]*vx + proj[5]*vy + proj[9]*vz + proj[13];
      const pw = proj[3]*vx + proj[7]*vy + proj[11]*vz + proj[15];

      const ndcX = px2 / pw;
      const ndcY = py2 / pw;

      if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) {
        el.style.display = 'none'; continue;
      }

      const screenX = (ndcX * 0.5 + 0.5) * width;
      const screenY = (1.0 - (ndcY * 0.5 + 0.5)) * height;
      el.style.display = '';
      el.style.left = screenX + 'px';
      el.style.top = screenY + 'px';
    }

    gl.bindVertexArray(null);
  }

  setVisible(v: boolean) {
    this.container.querySelectorAll('.planet-label').forEach(el => {
      (el as HTMLElement).style.display = v ? '' : 'none';
    });
  }

  private parseColor(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  }

  private createProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const v = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(v, vs); gl.compileShader(v);
    const f = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(f, fs); gl.compileShader(f);
    const p = gl.createProgram()!;
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    return p;
  }

  getPlanets(): PlanetData[] {
    return this.planets;
  }
}
