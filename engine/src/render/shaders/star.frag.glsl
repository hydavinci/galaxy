#version 300 es
precision highp float;

in float v_brightness;
in vec3 v_color;
in float v_size;

out vec4 fragColor;

void main() {
    vec2 center = gl_PointCoord - 0.5;
    float r = length(center) * 2.0; // 0 at center, 1 at edge

    // Simple bright core with soft falloff
    float intensity;
    if (v_size < 3.0) {
        // Small stars: sharp dot
        intensity = smoothstep(1.0, 0.0, r);
    } else {
        // Larger stars: core + halo
        float core = exp(-r * r * 10.0);
        float halo = exp(-r * r * 2.5) * 0.4;
        intensity = core + halo;
    }

    // Color: brighter stars show whiter core
    vec3 color = mix(v_color, vec3(1.0), intensity * 0.5);

    float alpha = intensity * v_brightness;
    if (alpha < 0.003) discard;

    fragColor = vec4(color * v_brightness, intensity);
}
