#version 300 es
precision highp float;

in vec2 a_raDec;
in float a_mag;
in float a_bv;

uniform mat4 u_viewMatrix;
uniform mat4 u_projMatrix;
uniform float u_fov;
uniform vec2 u_viewport;
uniform float u_magLimit;

out float v_brightness;
out vec3 v_color;
out float v_size;

vec3 bvToColor(float bv) {
    float t = clamp(bv, -0.4, 2.0);
    vec3 color;
    if (t < 0.0) {
        color = vec3(0.7 + t * 0.5, 0.8 + t * 0.3, 1.0);
    } else if (t < 0.4) {
        color = vec3(0.9 + t * 0.2, 0.95, 1.0 - t * 0.3);
    } else if (t < 0.8) {
        color = vec3(1.0, 1.0 - (t - 0.4) * 0.4, 0.8 - (t - 0.4) * 0.6);
    } else {
        color = vec3(1.0, 0.7 - (t - 0.8) * 0.3, 0.3 - (t - 0.8) * 0.2);
    }
    return color;
}

void main() {
    float ra = a_raDec.x;
    float dec = a_raDec.y;
    vec3 pos = vec3(
        cos(dec) * cos(ra),
        sin(dec),
        cos(dec) * sin(ra)
    );

    vec4 viewPos = u_viewMatrix * vec4(pos, 0.0);
    gl_Position = u_projMatrix * vec4(viewPos.xyz, 1.0);

    // No atmospheric extinction - full sky visible
    float extinction = 1.0;

    // Cull stars behind camera
    if (viewPos.z > 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        v_brightness = 0.0;
        v_size = 0.0;
        return;
    }

    // Cull stars above mag limit
    if (a_mag > u_magLimit) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        v_brightness = 0.0;
        v_size = 0.0;
        return;
    }

    // Brightness: strong for constellation stars (mag 0-4)
    float normMag = (a_mag - (-1.5)) / (15.0 - (-1.5)); // 0..1
    float brightness = pow(1.0 - normMag, 1.5) * 0.9 + 0.15;
    brightness = clamp(brightness, 0.12, 1.0);

    // Point size: bright stars much larger for visibility
    float fovScale = min(3.0, 60.0 / degrees(u_fov));
    float sizeMag = clamp((6.0 - a_mag) / 7.5, 0.0, 1.0); // 1 for bright, 0 for dim
    float pointSize = 1.5 + sizeMag * sizeMag * 35.0 * fovScale;
    pointSize = clamp(pointSize, 1.5, 45.0);

    gl_PointSize = pointSize;
    v_brightness = brightness * extinction;
    v_color = bvToColor(a_bv);
    v_size = pointSize;
}
