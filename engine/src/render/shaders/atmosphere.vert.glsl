#version 300 es
const vec2 positions[3] = vec2[3](
  vec2(-1, -1), vec2(3, -1), vec2(-1, 3)
);
out vec2 v_ndc;
void main() {
  v_ndc = positions[gl_VertexID];
  gl_Position = vec4(v_ndc, 0.999, 1.0);
}
