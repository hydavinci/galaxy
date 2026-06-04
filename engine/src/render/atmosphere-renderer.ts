import atmosVert from './shaders/atmosphere.vert.glsl';
import atmosFrag from './shaders/atmosphere.frag.glsl';

export class AtmosphereRenderer {
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private loc_invViewProj!: WebGLUniformLocation;

  constructor(private gl: WebGL2RenderingContext) {}

  init() {
    const gl = this.gl;
    this.program = this.createProgram(atmosVert, atmosFrag);
    this.vao = gl.createVertexArray()!;
    gl.useProgram(this.program);
    this.loc_invViewProj = gl.getUniformLocation(this.program, 'u_invViewProj')!;
  }

  render(view: Float32Array, proj: Float32Array) {
    const gl = this.gl;

    // Compute inverse of proj * view
    const vp = this.multiply4x4(proj, view);
    const inv = this.invert4x4(vp);
    if (!inv) return;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.loc_invViewProj, false, inv);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
  }

  private multiply4x4(a: Float32Array, b: Float32Array): Float32Array {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[k * 4 + j] * b[i * 4 + k];
        }
        r[i * 4 + j] = sum;
      }
    }
    return r;
  }

  private invert4x4(m: Float32Array): Float32Array | null {
    const inv = new Float32Array(16);
    const m00=m[0],m01=m[1],m02=m[2],m03=m[3],
          m10=m[4],m11=m[5],m12=m[6],m13=m[7],
          m20=m[8],m21=m[9],m22=m[10],m23=m[11],
          m30=m[12],m31=m[13],m32=m[14],m33=m[15];

    inv[0] = m11*m22*m33 - m11*m23*m32 - m21*m12*m33 + m21*m13*m32 + m31*m12*m23 - m31*m13*m22;
    inv[4] = -m10*m22*m33 + m10*m23*m32 + m20*m12*m33 - m20*m13*m32 - m30*m12*m23 + m30*m13*m22;
    inv[8] = m10*m21*m33 - m10*m23*m31 - m20*m11*m33 + m20*m13*m31 + m30*m11*m23 - m30*m13*m21;
    inv[12] = -m10*m21*m32 + m10*m22*m31 + m20*m11*m32 - m20*m12*m31 - m30*m11*m22 + m30*m12*m21;
    inv[1] = -m01*m22*m33 + m01*m23*m32 + m21*m02*m33 - m21*m03*m32 - m31*m02*m23 + m31*m03*m22;
    inv[5] = m00*m22*m33 - m00*m23*m32 - m20*m02*m33 + m20*m03*m32 + m30*m02*m23 - m30*m03*m22;
    inv[9] = -m00*m21*m33 + m00*m23*m31 + m20*m01*m33 - m20*m03*m31 - m30*m01*m23 + m30*m03*m21;
    inv[13] = m00*m21*m32 - m00*m22*m31 - m20*m01*m32 + m20*m02*m31 + m30*m01*m22 - m30*m02*m21;
    inv[2] = m01*m12*m33 - m01*m13*m32 - m11*m02*m33 + m11*m03*m32 + m31*m02*m13 - m31*m03*m12;
    inv[6] = -m00*m12*m33 + m00*m13*m32 + m10*m02*m33 - m10*m03*m32 - m30*m02*m13 + m30*m03*m12;
    inv[10] = m00*m11*m33 - m00*m13*m31 - m10*m01*m33 + m10*m03*m31 + m30*m01*m13 - m30*m03*m11;
    inv[14] = -m00*m11*m32 + m00*m12*m31 + m10*m01*m32 - m10*m02*m31 - m30*m01*m12 + m30*m02*m11;
    inv[3] = -m01*m12*m23 + m01*m13*m22 + m11*m02*m23 - m11*m03*m22 - m21*m02*m13 + m21*m03*m12;
    inv[7] = m00*m12*m23 - m00*m13*m22 - m10*m02*m23 + m10*m03*m22 + m20*m02*m13 - m20*m03*m12;
    inv[11] = -m00*m11*m23 + m00*m13*m21 + m10*m01*m23 - m10*m03*m21 - m20*m01*m13 + m20*m03*m11;
    inv[15] = m00*m11*m22 - m00*m12*m21 - m10*m01*m22 + m10*m02*m21 + m20*m01*m12 - m20*m02*m11;

    let det = m00*inv[0] + m01*inv[4] + m02*inv[8] + m03*inv[12];
    if (Math.abs(det) < 1e-10) return null;
    det = 1.0 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  }

  private createProgram(vsrc: string, fsrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS))
      throw new Error('Atmosphere VS: ' + gl.getShaderInfoLog(vs));
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS))
      throw new Error('Atmosphere FS: ' + gl.getShaderInfoLog(fs));
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('Atmosphere Link: ' + gl.getProgramInfoLog(prog));
    return prog;
  }
}
