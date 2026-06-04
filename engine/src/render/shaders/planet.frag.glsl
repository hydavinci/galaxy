#version 300 es
precision highp float;

uniform vec4 u_color;
out vec4 fragColor;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    
    // Solid white core + soft colored glow
    float solidCore = 1.0 - smoothstep(0.0, 0.3, r);
    float glow = exp(-r * r / (2.0 * 0.25 * 0.25));
    float outerGlow = exp(-r * r / (2.0 * 0.5 * 0.5));
    
    float intensity = solidCore + glow * 0.5 + outerGlow * 0.15;
    intensity = min(intensity, 1.0);
    
    // White center, color at edges
    vec3 color = mix(vec3(1.0), u_color.rgb, smoothstep(0.1, 0.5, r));
    
    float alpha = intensity * u_color.a;
    if (alpha < 0.005) discard;
    fragColor = vec4(color * intensity, alpha);
}
