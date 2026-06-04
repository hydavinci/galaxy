#version 300 es
precision highp float;

in vec2 v_uv;
uniform mat4 u_invViewProj;
uniform sampler2D u_texture;
uniform float u_brightness;

out vec4 fragColor;

void main() {
    // Reconstruct world direction from NDC
    vec4 clipPos = vec4(v_uv, -1.0, 1.0);
    vec4 worldDir = u_invViewProj * clipPos;
    vec3 dir = normalize(worldDir.xyz / worldDir.w);

    // Convert equatorial (x,y,z) to galactic coordinates
    // Rotation matrix from equatorial J2000 to galactic
    // Using IAU 1958 galactic pole: RA=192.8595°, Dec=27.1284°, l_NCP=122.932°
    mat3 eqToGal = mat3(
        -0.0548756, -0.8734371, -0.4838350,
         0.4941094, -0.4448296,  0.7469823,
        -0.8676661, -0.1980764,  0.4559838
    );
    vec3 galDir = eqToGal * dir;

    // Galactic longitude and latitude
    float galLon = atan(galDir.y, galDir.x); // -pi to pi
    if (galLon < 0.0) galLon += 6.2831853;
    float galLat = asin(clamp(galDir.z, -1.0, 1.0));

    // Equirectangular UV in galactic coords
    // Texture has galactic center at center, lon increases left to right
    float u = galLon / 6.2831853;
    float v = 0.5 - galLat / 3.1415926;

    vec3 texColor = texture(u_texture, vec2(u, v)).rgb;
    float luminance = dot(texColor, vec3(0.299, 0.587, 0.114));
    
    vec3 color = texColor * u_brightness;
    fragColor = vec4(color, luminance * u_brightness);
}
