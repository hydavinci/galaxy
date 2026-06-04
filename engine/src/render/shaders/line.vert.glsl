#version 300 es
precision highp float;

in vec3 a_position;
uniform mat4 u_viewMatrix;
uniform mat4 u_projMatrix;

void main() {
    vec4 viewPos = u_viewMatrix * vec4(a_position, 0.0);
    gl_Position = u_projMatrix * vec4(viewPos.xyz, 1.0);
}
