#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_invViewProj;
out vec4 fragColor;

void main() {
  vec4 clipPos = vec4(v_ndc, -1.0, 1.0);
  vec4 worldDir = u_invViewProj * clipPos;
  vec3 dir = normalize(worldDir.xyz / worldDir.w);
  float alt = asin(dir.y);

  // Subtle sky glow - slightly brighter deep blue, not pure black
  vec3 sky = vec3(0.012, 0.016, 0.035);
  fragColor = vec4(sky, 1.0);
}
