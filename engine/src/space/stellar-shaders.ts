/** Smooth catalog-star geometry locator, NOT a resolved observation or surface map.
 * No procedural features, texture, rotation pattern or star-specific surface detail.
 * Generic limb darkening and temperature-derived display tint are illustrations;
 * shared QUAD_VERT + circular optics retain the estimated physical model radius.
 */
export const STELLAR_SURFACE_FRAG = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform vec2 u_centerNdc;
uniform vec2 u_tanFov;
uniform float u_radius;
uniform vec3 u_color; // approximate display tint, not a photograph or color measurement
uniform float u_surfaceMix;
uniform float u_pointEnergy;
uniform vec3 u_pointColor;
uniform float u_diameter;
uniform float u_logDistance;
out vec4 outColor;
void main(){
  vec2 optical=(v_ndc-u_centerNdc)*u_tanFov;
  vec3 rayLocal=normalize(vec3(optical,1.0));
  vec3 closest=cross(rayLocal,cross(rayLocal,vec3(0,0,1)));
  float discriminant=u_radius*u_radius-dot(closest,closest);
  if(discriminant<0.0)discard;
  float root=sqrt(max(0.0,discriminant));
  // Purely radial smooth emission. No longitude/latitude/material feature exists.
  float mu=clamp(root/u_radius,0.0,1.0);
  float limb=.40+.60*pow(mu,.65);
  vec3 globe=u_color*(.78*limb);
  float tangent=u_radius/sqrt((1.0-u_radius)*(1.0+u_radius));
  float psfRadius=length(optical)/tangent*u_diameter/10.0;
  float r2=psfRadius*psfRadius;
  float psf=exp(-8.0*r2)+.012*exp(-2.0*r2);
  vec3 point=u_pointColor*(1.0-exp(-u_pointEnergy*psf));
  if(psfRadius>1.0)point=vec3(0.0);
  // Entire previous point (including its core/halo) is absent from the old pass.
  // This continuous 10–20 CSS px reveal uses the same finite-radius globe.
  outColor=vec4(mix(point,globe,u_surfaceMix),1.0);
  float hitDistance=rayLocal.z-root;
  gl_FragDepth=clamp((u_logDistance+log2(max(1e-12,hitDistance))+40.0)/80.0,.0000001,.999999);
}
`;
