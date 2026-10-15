// Finite 3D camera-relative rendering. All body uniforms are unit-scale / logarithmic;
// heliocentric world coordinates NEVER enter a float32 shader. No ground horizon.
export { QUAD_VERT } from '../observer/shaders/sky';

export const SPACE_STAR_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_direction; // double-subtracted on CPU, then normalized
layout(location=1) in vec3 a_photometry; // new observer magnitude, B-V, logarithmic AU depth
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_forward;
uniform vec2 u_tanFov;
uniform float u_limit;
uniform float u_exposure;
uniform float u_dpr;
uniform float u_maxPointSize;
uniform float u_locator;
out float v_energy;
out vec3 v_color;
vec3 starColor(float bv) {
  float b=clamp(bv,-0.4,2.0);
  float t=4600.0*(1.0/(0.92*b+1.7)+1.0/(0.92*b+0.62));
  vec3 c=t<6500.0?mix(vec3(1.0,.78,.58),vec3(1.0),smoothstep(2800.0,6500.0,t))
                     :mix(vec3(1.0),vec3(.73,.84,1.0),smoothstep(6500.0,24000.0,t));
  return mix(vec3(1.0),c,.7);
}
void main() {
  vec3 view=vec3(dot(a_direction,u_right),dot(a_direction,u_up),dot(a_direction,u_forward));
  float magnitude=clamp(a_photometry.x,-30.0,40.0);
  float threshold=1.0-smoothstep(u_limit-.45,u_limit+.15,magnitude);
  v_energy=pow(10.0,-.4*magnitude)*u_exposure*threshold;
  v_color=starColor(a_photometry.y);
  // Display PSF / optional unresolved planet locator, NOT an inflated physical surface.
  float diameter=u_locator>.5?5.0:clamp(3.0+1.3*log2(1.0+v_energy),3.0,10.0);
  gl_PointSize=min(u_maxPointSize,diameter*u_dpr);
  gl_Position=vec4(view.xy/u_tanFov,(a_photometry.z*2.0-1.0)*view.z,view.z);
  if(view.z<=0.0||magnitude>u_limit+.15||v_energy<.0001) {
    gl_Position=vec4(2.0,2.0,2.0,1.0);v_energy=0.0;
  }
}
`;
export const SPACE_STAR_FRAG = `#version 300 es
precision highp float;
in float v_energy;
in vec3 v_color;
out vec4 outColor;
void main(){
  vec2 p=gl_PointCoord*2.0-1.0;float r2=dot(p,p);
  if(r2>1.0||v_energy<=0.0)discard;
  float psf=exp(-8.0*r2)+.012*exp(-2.0*r2);
  outColor=vec4(v_color*(1.0-exp(-v_energy*psf)),1.0);
}
`;

export const SPACE_BODY_FRAG = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform vec2 u_centerNdc;
uniform vec2 u_tanFov;
uniform vec3 u_bodyRight;
uniform vec3 u_bodyUp;
uniform vec3 u_bodyForward;
uniform float u_radius; // radius AU / double-precision observer distance AU
uniform vec3 u_light; // true target→Sun direction in same EQJ Y-up world
uniform vec3 u_axisNorth;
uniform vec3 u_axisPrime;
uniform vec3 u_axisEast;
uniform sampler2D u_texture;
uniform float u_hasTexture;
uniform sampler2D u_ringTexture;
uniform float u_hasRing; // 0 none, 1 neutral geometry illustration, 2 ready radial profile
uniform vec2 u_ringRadii;
uniform vec3 u_color;
uniform float u_sun;
uniform float u_moon;
uniform float u_earth;
uniform float u_mars;
uniform float u_logDistance; // log2(physical distance AU), preserving relative GPU precision
uniform float u_cinematic; // artistic exposure/rim/bloom, NOT a weather or spectral model
out vec4 outColor;
vec3 toWorld(vec3 p){return u_bodyRight*p.x+u_bodyUp*p.y+u_bodyForward*p.z;}
void main(){
  // Circular display mapping, centered at the physical pinhole-projected world
  // position; true sphere radius / observer distance. Translation is genuine 3D.
  vec3 rayLocal=normalize(vec3((v_ndc-u_centerNdc)*u_tanFov,1.0));
  vec3 closest=cross(rayLocal,cross(rayLocal,vec3(0.0,0.0,1.0)));
  float discriminant=u_radius*u_radius-dot(closest,closest);
  bool sphereHit=discriminant>=0.0;
  vec3 ray=normalize(toWorld(rayLocal));
  vec3 light=length(u_light)>.01?normalize(u_light):vec3(0.0,1.0,0.0);
  vec3 body=vec3(0.0);
  float opacity=0.0;
  float hitDistance=rayLocal.z;
  if(sphereHit){
    float root=sqrt(max(0.0,discriminant));
    vec3 n=normalize(toWorld(closest-rayLocal*root));
    hitDistance=rayLocal.z-root;
    vec2 uv=vec2(.5+atan(dot(n,u_axisEast),dot(n,u_axisPrime))/6.28318530718,
                 acos(clamp(dot(n,u_axisNorth),-1.0,1.0))/3.14159265359);
    vec2 dx=dFdx(uv),dy=dFdy(uv);dx.x-=round(dx.x);dy.x-=round(dy.x);
    vec3 albedo=u_hasTexture>.5?textureGrad(u_texture,uv,dx,dy).rgb:u_color;
    float mu0=max(0.0,dot(n,light)),mu=max(0.0,dot(n,-ray));
    float reflected=mu0;
    if(u_moon>.5)reflected=mu0>0.0?.65*(2.0*mu0/(mu0+mu+.0001))+.35*mu0:0.0;
    float illumination=u_sun>.5?.45+.55*mu:reflected;
    // Nightside stays physically unlit; no fixed 'Earth preview' light/ambient.
    vec3 linear=pow(albedo,vec3(2.2))*illumination;
    body=pow(max(linear,vec3(0.0)),vec3(1.0/2.2));
    if(u_cinematic>.5){
      body*=u_sun>.5?1.12:1.08;
      float litRim=pow(1.0-mu,3.0)*smoothstep(-.15,.35,dot(n,light));
      body+=u_earth*vec3(.075,.29,.7)*litRim*.65;
      body+=u_mars*vec3(.36,.14,.04)*litRim*.35;
    }
    opacity=1.0;
  }
  if(u_hasRing>.5){
    vec3 northLocal=vec3(dot(u_axisNorth,u_bodyRight),dot(u_axisNorth,u_bodyUp),dot(u_axisNorth,u_bodyForward));
    float denominator=dot(rayLocal,northLocal);
    if(abs(denominator)>.0000001){
      float along=-dot(closest,northLocal)/denominator;
      vec3 ringLocal=(closest+rayLocal*along)/u_radius;
      float radial=length(ringLocal);
      bool front=!sphereHit||along < -sqrt(max(0.0,discriminant));
      if(rayLocal.z+along>0.0&&front&&radial>=u_ringRadii.x&&radial<=u_ringRadii.y){
        float radialUv=(radial-u_ringRadii.x)/(u_ringRadii.y-u_ringRadii.x);
        // No invented fine bands. The neutral fallback preserves only ring
        // geometry/occlusion; it is explicitly NOT an observed radial profile.
        vec4 profile=vec4(.65,.65,.65,.55);
        if(u_hasRing>1.5)profile=texture(u_ringTexture,vec2(radialUv,.5));
        vec3 point=toWorld(ringLocal);
        float alongSun=dot(point,light);
        bool planetShadow=alongSun<0.0&&dot(point,point)-alongSun*alongSun<1.0;
        float lighting=planetShadow?0.0:.08+.92*sqrt(abs(dot(u_axisNorth,light)));
        vec3 ringColor=pow(pow(profile.rgb,vec3(2.2))*lighting,vec3(1.0/2.2));
        if(sphereHit)body=mix(body,ringColor,profile.a);
        else {body=ringColor;opacity=profile.a;}
        if(profile.a>.001)hitDistance=rayLocal.z+along;
      }
    }
  }
  // Only a narrow, alpha-blended artist's scattering shell. Not a bitmap backdrop,
  // not a weather map, and the actual sphere limb/radius above is unchanged.
  if(!sphereHit&&u_cinematic>.5&&u_hasRing<.5){
    float impact=length(closest)/u_radius;
    vec3 tangentNormal=normalize(toWorld(closest));
    float sunward=smoothstep(-.12,.28,dot(tangentNormal,light));
    if(u_earth>.5&&impact<1.045){
      opacity=.55*exp(-(impact-1.0)*105.0)*sunward*(1.0-smoothstep(1.03,1.045,impact));
      body=vec3(.12,.43,.95);
    }else if(u_mars>.5&&impact<1.025){
      opacity=.2*exp(-(impact-1.0)*155.0)*sunward*(1.0-smoothstep(1.015,1.025,impact));
      body=vec3(.7,.3,.11);
    }else if(u_sun>.5&&impact<1.35){
      opacity=.19*exp(-(impact-1.0)*10.0)*(1.0-smoothstep(1.22,1.35,impact));
      body=vec3(1.0,.58,.18);
    }
  }
  if(opacity<=.001)discard; // no black rectangle and no writes in transparent gaps
  outColor=vec4(body,opacity);
  gl_FragDepth=clamp((u_logDistance+log2(max(1e-12,hitDistance))+40.0)/80.0,.0000001,.999999);
}
`;
