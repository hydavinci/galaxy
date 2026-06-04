import lineVert from './shaders/line.vert.glsl';
import lineFrag from './shaders/line.frag.glsl';

export class GridRenderer {
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private vertexCount = 0;
  private locs: Record<string, WebGLUniformLocation> = {};

  constructor(private gl: WebGL2RenderingContext) {}

  init() {
    const gl = this.gl;
    this.program = this.createProgram(lineVert, lineFrag);

    // Generate grid lines (RA/Dec)
    const verts: number[] = [];
    const steps = 72;

    // Dec circles every 15 degrees
    for (let dec = -75; dec <= 75; dec += 15) {
      const decRad = dec * Math.PI / 180;
      for (let i = 0; i < steps; i++) {
        const ra1 = (i / steps) * 2 * Math.PI;
        const ra2 = ((i + 1) / steps) * 2 * Math.PI;
        verts.push(Math.cos(decRad) * Math.cos(ra1), Math.sin(decRad), Math.cos(decRad) * Math.sin(ra1));
        verts.push(Math.cos(decRad) * Math.cos(ra2), Math.sin(decRad), Math.cos(decRad) * Math.sin(ra2));
      }
    }

    // RA lines every 30 degrees (2h)
    for (let raH = 0; raH < 24; raH += 2) {
      const ra = raH * 15 * Math.PI / 180;
      for (let i = 0; i < steps; i++) {
        const dec1 = (i / steps) * Math.PI - Math.PI / 2;
        const dec2 = ((i + 1) / steps) * Math.PI - Math.PI / 2;
        verts.push(Math.cos(dec1) * Math.cos(ra), Math.sin(dec1), Math.cos(dec1) * Math.sin(ra));
        verts.push(Math.cos(dec2) * Math.cos(ra), Math.sin(dec2), Math.cos(dec2) * Math.sin(ra));
      }
    }

    this.vertexCount = verts.length / 3;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    gl.useProgram(this.program);
    this.locs['u_viewMatrix'] = gl.getUniformLocation(this.program, 'u_viewMatrix')!;
    this.locs['u_projMatrix'] = gl.getUniformLocation(this.program, 'u_projMatrix')!;
    this.locs['u_color'] = gl.getUniformLocation(this.program, 'u_color')!;
  }

  render(view: Float32Array, proj: Float32Array) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locs['u_viewMatrix'], false, view);
    gl.uniformMatrix4fv(this.locs['u_projMatrix'], false, proj);
    gl.uniform4f(this.locs['u_color'], 0.25, 0.45, 0.8, 0.5);
    gl.lineWidth(1.5);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  private createProgram(vsrc: string, fsrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS))
      throw new Error('Vertex shader: ' + gl.getShaderInfoLog(vs));
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS))
      throw new Error('Fragment shader: ' + gl.getShaderInfoLog(fs));
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    return prog;
  }
}
