/** Shared standard-atmosphere horizon refraction, used by stars, lines and HiPS. */
// Maximum of the clamped normal model is <0.65 degrees at geometric altitude -1.
// A conservative 0.7-degree cap also covers float rounding and vertex interpolation.
export const REFRACTION_CULL_MARGIN_RAD = 0.7 * Math.PI / 180;
export function refractHorizonDirection(p: readonly number[]): [number, number, number] {
  const rad = Math.PI / 180;
  const altitude = Math.asin(Math.max(-1, Math.min(1, p[1]))) / rad;
  const h = Math.max(-1, altitude);
  let correction = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * rad) / 60;
  if (altitude < -1) correction *= (altitude + 90) / 89;
  const a = Math.min(90, Math.max(-90, altitude + Math.max(0, correction))) * rad;
  const horizontal = Math.hypot(p[0], p[2]);
  return horizontal < 1e-6 ? [p[0], p[1], p[2]]
    : [p[0] * Math.cos(a) / horizontal, Math.sin(a), p[2] * Math.cos(a) / horizontal];
}

export const REFRACTION_GLSL = `
vec3 refractDirection(vec3 p, float enabled) {
  if (enabled < 0.5) return p;
  float alt = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float h = max(-1.0, alt);
  float correction = 1.02 / tan(radians(h + 10.3 / (h + 5.11))) / 60.0;
  if (alt < -1.0) correction *= (alt + 90.0) / 89.0;
  float a = radians(clamp(alt + max(0.0, correction), -90.0, 90.0));
  float horizontal = length(p.xz);
  return horizontal < 0.000001 ? p : vec3(p.x * cos(a) / horizontal, sin(a), p.z * cos(a) / horizontal);
}
`;
