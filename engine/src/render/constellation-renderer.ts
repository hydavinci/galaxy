import lineVert from './shaders/line.vert.glsl';
import lineFrag from './shaders/line.frag.glsl';
import { CONSTELLATIONS } from '../data/constellations';

export class ConstellationRenderer {
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private vertexCount = 0;
  private locs: Record<string, WebGLUniformLocation> = {};
  private labelContainer!: HTMLDivElement;
  private labels: { el: HTMLSpanElement; cx: number; cy: number; cz: number }[] = [];

  constructor(private gl: WebGL2RenderingContext) {}

  init() {
    const gl = this.gl;
    this.program = this.createProgram(lineVert, lineFrag);
    this.locs = {
      u_viewMatrix: gl.getUniformLocation(this.program, 'u_viewMatrix')!,
      u_projMatrix: gl.getUniformLocation(this.program, 'u_projMatrix')!,
      u_color: gl.getUniformLocation(this.program, 'u_color')!,
    };

    // Build line vertex data
    const vertices: number[] = [];
    for (const c of CONSTELLATIONS) {
      for (const [ra1, dec1, ra2, dec2] of c.lines) {
        const x1 = Math.cos(dec1) * Math.cos(ra1);
        const y1 = Math.sin(dec1);
        const z1 = Math.cos(dec1) * Math.sin(ra1);
        const x2 = Math.cos(dec2) * Math.cos(ra2);
        const y2 = Math.sin(dec2);
        const z2 = Math.cos(dec2) * Math.sin(ra2);
        vertices.push(x1, y1, z1, x2, y2, z2);
      }
    }
    this.vertexCount = vertices.length / 3;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Create label overlay
    this.labelContainer = document.createElement('div');
    this.labelContainer.id = 'constellation-labels';
    this.labelContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:5;';
    (gl.canvas as HTMLCanvasElement).parentElement?.appendChild(this.labelContainer);
    console.log('Constellation labels container added, creating labels...');

    // Create labels for each constellation (compute center from line endpoints)
    for (const c of CONSTELLATIONS) {
      let sx = 0, sy = 0, sz = 0, count = 0;
      for (const [ra1, dec1, ra2, dec2] of c.lines) {
        sx += Math.cos(dec1) * Math.cos(ra1) + Math.cos(dec2) * Math.cos(ra2);
        sy += Math.sin(dec1) + Math.sin(dec2);
        sz += Math.cos(dec1) * Math.sin(ra1) + Math.cos(dec2) * Math.sin(ra2);
        count += 2;
      }
      if (count === 0) continue;
      // Normalize center direction
      const len = Math.sqrt(sx*sx + sy*sy + sz*sz) || 1;
      const cx = sx / len, cy = sy / len, cz = sz / len;

      const el = document.createElement('span');
      el.textContent = c.name;
      el.style.cssText = 'position:absolute;color:rgba(130,180,180,0.6);font-size:11px;font-family:sans-serif;letter-spacing:1px;white-space:nowrap;transform:translate(-50%,-50%);';
      this.labelContainer.appendChild(el);
      this.labels.push({ el, cx, cy, cz });
    }
    console.log(`Created ${this.labels.length} constellation labels`);
  }

  setLabelsVisible(visible: boolean) {
    this.labelContainer.style.display = visible ? '' : 'none';
  }

  render(view: Float32Array, proj: Float32Array) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locs.u_viewMatrix, false, view);
    gl.uniformMatrix4fv(this.locs.u_projMatrix, false, proj);
    gl.uniform4f(this.locs.u_color, 0.3, 0.6, 0.6, 0.45);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);
    gl.bindVertexArray(null);

    // Update label positions
    const canvas = gl.canvas as HTMLCanvasElement;
    const w = canvas.clientWidth, h = canvas.clientHeight;

    for (const label of this.labels) {
      // View transform
      const vx = view[0]*label.cx + view[4]*label.cy + view[8]*label.cz;
      const vy = view[1]*label.cx + view[5]*label.cy + view[9]*label.cz;
      const vz = view[2]*label.cx + view[6]*label.cy + view[10]*label.cz;

      if (vz > 0) {
        label.el.style.display = 'none';
        continue;
      }

      // Project (standard perspective: clipW = -vz)
      const ndcX = (proj[0] * vx) / (-vz);
      const ndcY = (proj[5] * vy) / (-vz);

      if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) {
        label.el.style.display = 'none';
        continue;
      }

      const sx = (ndcX * 0.5 + 0.5) * w;
      const sy = (1 - (ndcY * 0.5 + 0.5)) * h;

      label.el.style.display = '';
      label.el.style.left = sx + 'px';
      label.el.style.top = sy + 'px';
    }
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
}
