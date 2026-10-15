/** Catalog-star photospheres are procedural MODEL ILLUSTRATIONS, not maps,
 * starspot measurements, weather, convection simulation or measured rotation.
 * Shared QUAD_VERT + body-local circular optics retain the actual model radius.
 * No light/Sun/time/texture uniforms: self-emission and inertially fixed pattern.
 */
export const STELLAR_SURFACE_FRAG = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform vec2 u_centerNdc;
uniform vec2 u_tanFov;
uniform vec3 u_bodyRight;
uniform vec3 u_bodyUp;
uniform vec3 u_bodyForward;
uniform float u_radius;
uniform vec3 u_axisNorth;
uniform vec3 u_axisPrime;
uniform vec3 u_axisEast;
uniform vec3 u_color; // bounded display tint from temperature, not a spectroscopic image
uniform float u_temperature;
uniform float u_seed;
uniform float u_surfaceMix;
uniform float u_pointEnergy;
uniform vec3 u_pointColor;
uniform float u_diameter;
uniform float u_logDistance;
out vec4 outColor;
vec3 toWorld(vec3 p){return u_bodyRight*p.x+u_bodyUp*p.y+u_bodyForward*p.z;}
float hash3(vec3 p){
  p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);
  return fract((p.x+p.y)*p.z);
}
float noise3(vec3 p){
  vec3 cell=floor(p),f=fract(p);f=f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(mix(hash3(cell),hash3(cell+vec3(1,0,0)),f.x),
                 mix(hash3(cell+vec3(0,1,0)),hash3(cell+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(cell+vec3(0,0,1)),hash3(cell+vec3(1,0,1)),f.x),
                 mix(hash3(cell+vec3(0,1,1)),hash3(cell+vec3(1,1,1)),f.x),f.y),f.z);
}
float filteredNoise(vec3 p){
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  // Unresolved cells fade to their mean, not swimming/aliased pixel noise.
  return (noise3(p)-.5)*(1.0-smoothstep(.25,1.0,footprint));
}
void main(){
  vec2 optical=(v_ndc-u_centerNdc)*u_tanFov;
  vec3 rayLocal=normalize(vec3(optical,1.0));
  vec3 closest=cross(rayLocal,cross(rayLocal,vec3(0,0,1)));
  float discriminant=u_radius*u_radius-dot(closest,closest);
  // Evaluate pattern derivatives before the disk discard, including limb quads.
  float root=sqrt(max(0.0,discriminant));
  vec3 n=normalize(toWorld(closest-rayLocal*root));
  vec3 ray=normalize(toWorld(rayLocal));
  vec3 object=vec3(dot(n,u_axisPrime),dot(n,u_axisNorth),dot(n,u_axisEast));
  vec3 seed=vec3(u_seed*71.3,u_seed*113.7,u_seed*37.9);
  float cells=mix(26.0,48.0,smoothstep(3000.0,12000.0,u_temperature));
  float large=filteredNoise(object*5.0+seed);
  float granules=filteredNoise(object*cells+seed);
  float fine=filteredNoise(object*cells*2.1+seed);
  // Weak, stationary variations: no invented discrete measured starspots.
  float surface=1.0+.12*large+.30*granules+.10*fine;
  float mu=max(0.0,dot(n,-ray));
  float limb=.40+.60*pow(mu,.65);
  vec3 globe=u_color*(.78*limb*surface);
  float tangent=u_radius/sqrt((1.0-u_radius)*(1.0+u_radius));
  float psfRadius=length(optical)/tangent*u_diameter/10.0;
  float r2=psfRadius*psfRadius;
  float psf=exp(-8.0*r2)+.012*exp(-2.0*r2);
  vec3 point=u_pointColor*(1.0-exp(-u_pointEnergy*psf));
  if(psfRadius>1.0)point=vec3(0.0);
  // Entire previous point (including its core/halo) is absent from the old pass.
  // This continuous 10–20 CSS px reveal uses the same finite-radius globe.
  if(discriminant<0.0)discard;
  outColor=vec4(mix(point,globe,u_surfaceMix),1.0);
  float hitDistance=rayLocal.z-root;
  gl_FragDepth=clamp((u_logDistance+log2(max(1e-12,hitDistance))+40.0)/80.0,.0000001,.999999);
}
`;
