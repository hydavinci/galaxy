// GLSL is kept as strings so numerical/mock tests do not need a browser/Vite loader.
// All directions below are horizon x=east, y=up, z=south.
import { REFRACTION_GLSL } from '../../hips/refraction';
export { REFRACTION_GLSL } from '../../hips/refraction';

export const STAR_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_star; // J2000 RA, Dec radians; visual mag; B-V
uniform mat4 u_equatorial;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform float u_refraction;
uniform float u_ground;
uniform float u_atmosphere;
uniform float u_limit;
uniform float u_exposure;
uniform float u_visibility;
uniform float u_dpr;
uniform float u_maxPointSize;
out float v_energy;
out vec3 v_color;
${REFRACTION_GLSL}
vec3 starColor(float bv) {
  // Ballesteros B-V temperature followed by a deliberately restrained visual tint.
  float b = clamp(bv, -0.4, 2.0);
  float t = 4600.0 * (1.0/(0.92*b + 1.7) + 1.0/(0.92*b + 0.62));
  vec3 warm = vec3(1.0, 0.78, 0.58);
  vec3 cool = vec3(0.73, 0.84, 1.0);
  vec3 rgb = t < 6500.0 ? mix(warm, vec3(1.0), smoothstep(2800.0, 6500.0, t))
                           : mix(vec3(1.0), cool, smoothstep(6500.0, 24000.0, t));
  return mix(vec3(1.0), rgb, 0.7);
}
void main() {
  vec3 eq = vec3(cos(a_star.y)*cos(a_star.x), sin(a_star.y), cos(a_star.y)*sin(a_star.x));
  vec3 h = normalize((u_equatorial * vec4(eq, 0.0)).xyz);
  h = refractDirection(h, u_refraction);
  vec3 view = (u_view * vec4(h, 0.0)).xyz;
  float altitude = degrees(asin(clamp(h.y,-1.0,1.0)));
  float airmass = 1.0 / (max(0.0,h.y) + 0.50572*pow(max(0.1,altitude + 6.07995),-1.6364));
  float extinctionMag = u_atmosphere * 0.20 * max(0.0,min(airmass,40.0)-1.0);
  float effectiveMag = a_star.z + extinctionMag;
  float threshold = 1.0 - smoothstep(u_limit - 0.45, u_limit + 0.15, effectiveMag);
  float flux = pow(10.0,-0.4*effectiveMag); // Pogson relative flux, not a linear magnitude ramp.
  v_energy = flux * u_exposure * u_visibility * threshold;
  v_color = starColor(a_star.w);
  // Compact PSF support; no giant fixed disks or random/generated stars.
  float diameter = clamp(3.0 + 1.3*log2(1.0 + v_energy),3.0,9.0);
  gl_PointSize = min(u_maxPointSize, diameter*u_dpr);
  gl_Position = u_proj * vec4(view,1.0);
  if (view.z >= 0.0 || effectiveMag > u_limit + 0.15 || v_energy < 0.0001 || (u_ground > 0.5 && h.y < 0.0)) {
    gl_Position = vec4(2.0,2.0,2.0,1.0);
    v_energy = 0.0;
  }
}
`;
export const STAR_FRAG = `#version 300 es
precision highp float;
in float v_energy;
in vec3 v_color;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord*2.0-1.0;
  float r2=dot(p,p);
  if (r2>1.0 || v_energy<=0.0) discard;
  float psf=exp(-8.0*r2) + 0.012*exp(-2.0*r2);
  float radiance=1.0-exp(-v_energy*psf);
  // Additive radiance with a soft PSF, not opaque circular star sprites.
  outColor=vec4(v_color*radiance,1.0);
}
`;

export const QUAD_VERT = `#version 300 es
precision highp float;
uniform vec4 u_rect;
out vec2 v_ndc;
void main(){
  vec2 corner=vec2((gl_VertexID==1 || gl_VertexID==2 || gl_VertexID==4)?1.0:0.0,
                   (gl_VertexID==2 || gl_VertexID==4 || gl_VertexID==5)?1.0:0.0);
  v_ndc=mix(u_rect.xy,u_rect.zw,corner);
  gl_Position=vec4(v_ndc,0.0,1.0);
}
`;
// Shared deterministic atmosphere. A visual approximation, not spectral radiative transfer.
export const ATMOSPHERE_GLSL = `
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_forward;
uniform vec2 u_tanFov;
uniform vec3 u_sunDirection;
uniform float u_sunAltitude;
uniform float u_atmosphere;
uniform float u_pollution;
vec3 screenRay(vec2 ndc) { return normalize(u_forward + u_right*ndc.x*u_tanFov.x + u_up*ndc.y*u_tanFov.y); }
vec3 skyColor(vec3 ray) {
  if (u_atmosphere < 0.5) return vec3(0.0004,0.0007,0.0014);
  float day=smoothstep(-7.0,8.0,u_sunAltitude);
  float twilight=exp(-pow((u_sunAltitude+4.0)/7.0,2.0));
  float horizon=exp(-max(ray.y,0.0)*4.5);
  float sunward=pow(max(0.0,dot(normalize(vec3(ray.x,0.001,ray.z)),normalize(vec3(u_sunDirection.x,0.001,u_sunDirection.z)))),5.0);
  vec3 night=mix(vec3(0.0005,0.0010,0.0023),vec3(0.010,0.014,0.024),u_pollution);
  night += vec3(0.018,0.012,0.006)*u_pollution*horizon;
  vec3 blue=mix(vec3(0.075,0.27,0.55),vec3(0.43,0.58,0.71),horizon);
  vec3 result=mix(night,blue,day);
  result+=twilight*horizon*mix(vec3(0.028,0.025,0.055),vec3(0.35,0.115,0.025),sunward);
  float solarHalo=pow(max(0.0,dot(ray,u_sunDirection)),100.0);
  result+=day*solarHalo*vec3(0.19,0.14,0.07);
  return result;
}
`;
export const SKY_FRAG = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform float u_groundPass;
out vec4 outColor;
${ATMOSPHERE_GLSL}
void main(){
  vec3 ray=screenRay(v_ndc);
  if(u_groundPass > 0.5) {
    if(ray.y >= 0.0) discard;
    // Intentionally level, abstract ground. No fabricated local topography.
    float day=smoothstep(-8.0,8.0,u_sunAltitude);
    vec3 ground=mix(vec3(0.004,0.006,0.006),vec3(0.045,0.055,0.039),day);
    outColor=vec4(ground*(0.75+0.25*exp(ray.y*6.0)),1.0);
  } else outColor=vec4(skyColor(ray),1.0);
}
`;

export const LINE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_direction;
uniform mat4 u_frame;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform float u_refraction;
out vec3 v_direction;
${REFRACTION_GLSL}
void main(){
 v_direction=refractDirection(normalize((u_frame*vec4(a_direction,0.0)).xyz),u_refraction);
 gl_Position=u_proj*vec4((u_view*vec4(v_direction,0.0)).xyz,1.0);
}
`;
export const LINE_FRAG = `#version 300 es
precision highp float;
in vec3 v_direction;
uniform vec4 u_color;
uniform float u_ground;
out vec4 outColor;
void main(){ if(u_ground>0.5 && v_direction.y < -0.00001) discard; outColor=u_color; }
`;

export const BODY_FRAG = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform vec2 u_centerNdc; // true projectDirection center; sky/HiPS projection is unchanged
uniform vec3 u_bodyRight;
uniform vec3 u_bodyUp;
uniform vec3 u_bodyForward;
uniform float u_radius; // physical sin(angularDiameter/2), never a display-inflated radius
uniform mat3 u_normalToGeometric;
uniform vec3 u_light;
uniform vec3 u_axisNorth;
uniform vec3 u_axisPrime;
uniform vec3 u_axisEast;
uniform sampler2D u_texture;
uniform float u_hasTexture;
uniform sampler2D u_ringTexture; // RGBA radial profile: inner edge u=0, outer u=1, v=.5
uniform float u_hasRing; // Saturn only, and only after an actual profile upload succeeded
uniform vec2 u_ringRadii; // C-ring inner / A-ring outer radius in physical globe radii
uniform vec3 u_color;
uniform float u_sun;
uniform float u_moon;
uniform float u_depth;
uniform float u_transmission;
out vec4 outColor;
${ATMOSPHERE_GLSL}
void main(){
  // Recenter the local optical window at the real projected body center.
  // Its sphere is on-axis at (0,0,1), so its limb is a CSS-pixel circle with
  // radius height*tan(angularDiameter/2)/(2*tan(FOV/2)) anywhere in the view.
  // This changes the body mapping, NOT merely an ellipse-clipping mask: normals,
  // viewing rays, illumination and UV all use the same transported local basis.
  // Cross products retain arcsecond precision without near-unit subtraction.
  vec3 rayLocal=normalize(vec3((v_ndc-u_centerNdc)*u_tanFov,1.0));
  vec3 closest=cross(rayLocal,cross(rayLocal,vec3(0.0,0.0,1.0)));
  float discriminant=u_radius*u_radius-dot(closest,closest);
  bool sphereHit=discriminant>=0.0;
  vec3 ray=normalize(u_bodyRight*rayLocal.x+u_bodyUp*rayLocal.y+u_bodyForward*rayLocal.z);
  vec3 body=vec3(0.0);
  if(sphereHit) {
    vec3 nLocal=normalize(closest-rayLocal*sqrt(discriminant));
    vec3 nApparent=normalize(u_bodyRight*nLocal.x+u_bodyUp*nLocal.y+u_bodyForward*nLocal.z);
    vec3 n=normalize(u_normalToGeometric*nApparent);
    vec2 uv=vec2(0.5 + atan(dot(n,u_axisEast),dot(n,u_axisPrime))/6.28318530718,
                 acos(clamp(dot(n,u_axisNorth),-1.0,1.0))/3.14159265359);
    vec3 albedo=u_color;
    // Periodic longitude's shortest derivative avoids the atan branch-cut seam.
    vec2 uvDx=dFdx(uv),uvDy=dFdy(uv);
    uvDx.x-=round(uvDx.x);uvDy.x-=round(uvDy.x);
    if(u_hasTexture>0.5) albedo=textureGrad(u_texture,uv,uvDx,uvDy).rgb;
    float mu0=max(0.0,dot(n,normalize(u_light)));
    float mu=max(0.0,dot(nApparent,-ray));
    float reflected=mu0;
    if(u_moon>0.5) reflected=mu0>0.0 ? 0.65*(2.0*mu0/(mu0+mu+0.0001))+0.35*mu0 : 0.0;
    float illumination=u_sun>0.5 ? (0.45+0.55*mu) : reflected;
    vec3 linear=pow(albedo,vec3(2.2))*illumination*u_transmission;
    body=pow(max(linear,vec3(0.0)),vec3(1.0/2.2));
  }
  float opacity=sphereHit?1.0:0.0;
  if(u_hasRing>0.5) {
    // Transport the physical IAU north pole into the SAME circular local optics
    // used by the sphere. An inclined equatorial plane is physically elliptical;
    // only the globe itself is required to remain a circle off axis.
    vec3 northLocal=vec3(dot(u_axisNorth,u_normalToGeometric*u_bodyRight),
      dot(u_axisNorth,u_normalToGeometric*u_bodyUp),dot(u_axisNorth,u_normalToGeometric*u_bodyForward));
    float denominator=dot(rayLocal,northLocal);
    if(abs(denominator)>0.0000001) {
      float along=-dot(closest,northLocal)/denominator;
      vec3 ringLocal=(closest+rayLocal*along)/u_radius;
      float radial=length(ringLocal);
      bool front=!sphereHit || along < -sqrt(max(0.0,discriminant));
      if(rayLocal.z+along>0.0 && front && radial>=u_ringRadii.x && radial<=u_ringRadii.y) {
        float radialUv=(radial-u_ringRadii.x)/(u_ringRadii.y-u_ringRadii.x);
        vec4 profile=texture(u_ringTexture,vec2(radialUv,0.5));
        vec3 point=u_normalToGeometric*(u_bodyRight*ringLocal.x+u_bodyUp*ringLocal.y+u_bodyForward*ringLocal.z);
        vec3 light=normalize(u_light);
        float alongSun=dot(point,light);
        bool planetShadow=alongSun<0.0 && dot(point,point)-alongSun*alongSun<1.0;
        // Simple two-sided diffuse/scattered sunlight, not photometric calibration.
        // Includes the globe's parallel-light umbra on rings; does NOT include
        // finite Sun, ring self-shadowing, or ring shadow cast onto the globe.
        float lighting=planetShadow?0.0:0.08+0.92*sqrt(abs(dot(u_axisNorth,light)));
        vec3 ringColor=pow(pow(profile.rgb,vec3(2.2))*lighting*u_transmission,vec3(1.0/2.2));
        if(sphereHit) body=mix(body,ringColor,profile.a);
        else {body=ringColor;opacity=profile.a;}
      }
    }
  }
  // Transparent annulus gaps/outside pixels never paint an opaque black quad or
  // touch depth. Rear rings disappear behind the sphere; front rings blend over it.
  if(opacity<=0.001)discard;
  float haze=u_atmosphere*smoothstep(-9.0,10.0,u_sunAltitude)*0.55;
  body=mix(body,skyColor(ray),haze);
  outColor=vec4(body,opacity);
  gl_FragDepth=u_depth; // monotonic physical-distance order; depth writes explicitly enabled by the body pass.
}
`;
