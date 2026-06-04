import starVert from './shaders/star.vert.glsl';
import starFrag from './shaders/star.frag.glsl';
import { LODCatalog } from '../data/lod-catalog';

export class StarRenderer {
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private starCount = 0;
  private locs: Record<string, WebGLUniformLocation> = {};
  private lodCatalog: LODCatalog;

  constructor(private gl: WebGL2RenderingContext) {
    this.lodCatalog = new LODCatalog();
  }

  async init() {
    const gl = this.gl;
    this.program = this.createProgram(starVert, starFrag);

    // Init LOD catalog
    await this.lodCatalog.init();
    const data = this.lodCatalog.getStarBuffer();
    this.starCount = this.lodCatalog.getStarCount();

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

    const aRaDec = gl.getAttribLocation(this.program, 'a_raDec');
    const aMag = gl.getAttribLocation(this.program, 'a_mag');
    const aBv = gl.getAttribLocation(this.program, 'a_bv');

    gl.enableVertexAttribArray(aRaDec);
    gl.vertexAttribPointer(aRaDec, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aMag);
    gl.vertexAttribPointer(aMag, 1, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(aBv);
    gl.vertexAttribPointer(aBv, 1, gl.FLOAT, false, 16, 12);

    gl.bindVertexArray(null);

    // Cache uniform locations
    gl.useProgram(this.program);
    this.locs['u_viewMatrix'] = gl.getUniformLocation(this.program, 'u_viewMatrix')!;
    this.locs['u_projMatrix'] = gl.getUniformLocation(this.program, 'u_projMatrix')!;
    this.locs['u_fov'] = gl.getUniformLocation(this.program, 'u_fov')!;
    this.locs['u_viewport'] = gl.getUniformLocation(this.program, 'u_viewport')!;
    this.locs['u_magLimit'] = gl.getUniformLocation(this.program, 'u_magLimit')!;
  }

  render(view: Float32Array, proj: Float32Array, fov: number, viewport: [number, number]) {
    const gl = this.gl;

    // Check if LOD has new data
    this.lodCatalog.update(fov);
    if (this.lodCatalog.isDirty()) {
      const data = this.lodCatalog.getStarBuffer();
      this.starCount = this.lodCatalog.getStarCount();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    }

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locs['u_viewMatrix'], false, view);
    gl.uniformMatrix4fv(this.locs['u_projMatrix'], false, proj);
    gl.uniform1f(this.locs['u_fov'], fov);
    gl.uniform2f(this.locs['u_viewport'], viewport[0], viewport[1]);

    // Adaptive mag limit based on FOV
    const fovDeg = fov * 180 / Math.PI;
    const magLimit = Math.min(15.0, 7.0 + (60.0 / fovDeg) * 3.0);
    gl.uniform1f(this.locs['u_magLimit'], magLimit);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.starCount);
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
