#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
    // Full-screen triangle
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
    v_uv = vec2(x, y);
}
