#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_normal;
in vec3 v_worldPos;

uniform sampler2D u_texture;
uniform vec3 u_sunDir;
uniform float u_ambient;
uniform float u_opacity;

out vec4 fragColor;

void main() {
    vec3 texColor = texture(u_texture, v_uv).rgb;
    vec3 normal = normalize(v_normal);
    float diffuse = max(dot(normal, u_sunDir), 0.0);
    vec3 lighting = texColor * (u_ambient + (1.0 - u_ambient) * diffuse);
    fragColor = vec4(lighting, u_opacity);
}
