import test from 'node:test';
import assert from 'node:assert/strict';
import {computeSky,DEFAULT_LOCATION} from '../src/observer/astronomy';
import {bodyInspectionFov} from '../src/observer/allsky';
import {angularDiameterCssPixels,bodyDiskContains,bodyViewGeometry,cameraBasis,horizontalDirection,projectDirection,projectedIlluminatedFraction} from '../src/observer/sky-renderer';
import {BODY_FRAG} from '../src/observer/shaders/sky';
import type {CameraState,Vec3} from '../src/observer/types';
const RAD=Math.PI/180;
const near=(a:number,b:number,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}, tolerance ${tol}`);
const dot=(a:Vec3,b:Vec3)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(a:Vec3):Vec3=>a.map(x=>x/Math.hypot(...a)) as Vec3;
const add=(a:Vec3,b:Vec3):Vec3=>a.map((x,i)=>x+b[i]) as Vec3;
const mul=(a:Vec3,k:number):Vec3=>a.map(x=>x*k) as Vec3;
const nearVec=(a:Vec3,b:Vec3,tol=1e-8)=>a.forEach((x,i)=>near(x,b[i],tol));
const ndcDirection=(nx:number,ny:number,c:CameraState,w:number,h:number):Vec3=>{
 const b=cameraBasis(c),t=Math.tan(c.fovDeg*RAD/2);
 return norm(add(b.forward,add(mul(b.right,nx*t*w/h),mul(b.up,ny*t))));
};
const sites=[[0,0],[-.75,0],[.75,0],[0,-.75],[0,.75],[-.75,-.75],[-.75,.75],[.75,-.75],[.75,.75]];
const geometry=(p:Vec3,d:number,c:CameraState,w:number,h:number)=>{
 const g=bodyViewGeometry(p,Math.sin(d/2),c,w,h);assert.ok(g);return g;
};
// Independent stable sphere intersection in the local optical window: closest
// point written component-wise, rather than importing production intersection.
function sample(g:ReturnType<typeof geometry>,diameter:number,qx:number,qy:number){
 const r=Math.sin(diameter/2),t=Math.tan(diameter/2),ray=norm([qx*t,qy*t,1]);
 const closest:Vec3=[ray[0]*ray[2],ray[1]*ray[2],-ray[0]*ray[0]-ray[1]*ray[1]];
 const disc=r*r-dot(closest,closest);if(disc<0)return null;
 const n=norm(add(closest,mul(ray,-Math.sqrt(disc))));
 const world=(v:Vec3)=>norm(add(mul(g.right,v[0]),add(mul(g.up,v[1]),mul(g.forward,v[2]))));
 return {normal:world(n),ray:world(ray)};
}

test('reproduce the retired off-axis pinhole ellipse; centered-scale circular contract is intentional',()=>{
 const alpha=.5341758*RAD/2;
 for(const thetaDeg of [30,45,50,60]){
  const theta=thetaDeg*RAD;
  const oldMajor=(Math.tan(theta+alpha)-Math.tan(theta-alpha))/2;
  const oldMinor=Math.sin(alpha)/Math.sqrt(Math.cos(theta)**2-Math.sin(alpha)**2);
  assert.ok(oldMajor/oldMinor>1.15,`${thetaDeg}: old silhouette is stretched`);
  near(oldMajor/oldMinor,1/Math.cos(theta),.0001);
  const c={azimuthDeg:0,altitudeDeg:0,fovDeg:110},p=horizontalDirection(thetaDeg,0),g=geometry(p,2*alpha,c,1600,900);
  near(g.radiusCssPixels,450*Math.tan(alpha)/Math.tan(55*RAD));
  // No off-axis sec(theta) or sec(theta)^2 magnification in either dimension.
  near((g.rect[2]-g.rect[0])*800,(g.rect[3]-g.rect[1])*450,1e-9);
 }
});

for(const [w,h] of [[1440,900],[390,844],[844,390]])for(const fovDeg of [70,110,.0001])test(`circle centers, equal CSS axes and inclusive limbs at ${w}x${h}, FOV ${fovDeg}`,()=>{
 const c={azimuthDeg:213,altitudeDeg:33,fovDeg};
 // A bounded 20px disk makes all cardinal and diagonal limbs observable even
 // for the minimum-FOV precision fixture; real-body sizes are checked below.
 const diameter=2*Math.atan(40*Math.tan(fovDeg*RAD/2)/h);
 for(const [nx,ny]of sites){
  const p=ndcDirection(nx,ny,c,w,h),g=geometry(p,diameter,c,w,h),projected=projectDirection(p,c,w,h);
  near((g.centerNdc[0]+1)*w/2,projected.x,1e-6);near((1-g.centerNdc[1])*h/2,projected.y,1e-6);
  near(g.radiusCssPixels,20,1e-9);near((g.rect[2]-g.rect[0])*w/2,40,1e-8);near((g.rect[3]-g.rect[1])*h/2,40,1e-8);
  const cx=(g.centerNdc[0]+1)*w/2,cy=(1-g.centerNdc[1])*h/2;
  for(let i=0;i<32;i++){
   const x=Math.cos(i*Math.PI/16),y=Math.sin(i*Math.PI/16);
   assert.equal(bodyDiskContains(p,diameter,c,w,h,cx+x*20,cy+y*20),true,'inclusive circular limb');
   assert.equal(bodyDiskContains(p,diameter,c,w,h,cx+x*20.001,cy+y*20.001),false,'outside limb');
   assert.ok(sample(g,diameter,x*.999,y*.999));assert.equal(sample(g,diameter,x*1.001,y*1.001),null);
  }
 }
});

for(const [w,h]of [[1200,800],[390,844]])test(`partially clipped disks retain visible limbs at every edge/corner: ${w}x${h}`,()=>{
 const c={azimuthDeg:113,altitudeDeg:-21,fovDeg:70},radius=40,diameter=2*Math.atan(radius*2*Math.tan(35*RAD)/h);
 const positions=[[-20,h/2],[w+20,h/2],[w/2,-20],[w/2,h+20],[-20,-20],[w+20,-20],[-20,h+20],[w+20,h+20]];
 for(const [x,y]of positions){
  const p=ndcDirection(2*x/w-1,1-2*y/h,c,w,h),g=geometry(p,diameter,c,w,h);
  assert.equal(projectDirection(p,c,w,h).visible,false);
  const px=Math.min(w,Math.max(0,x)),py=Math.min(h,Math.max(0,y));
  assert.equal(bodyDiskContains(p,diameter,c,w,h,px,py),true);
  assert.ok(g.rect.every(Number.isFinite));assert.ok(g.rect.every(n=>n>=-1&&n<=1));
 }
 // AABB overlaps at the corner, but the circular silhouette does not.
 for(const [x,y]of [[-30,-30],[w+30,-30],[-30,h+30],[w+30,h+30]]){
  const p=ndcDirection(2*x/w-1,1-2*y/h,c,w,h);assert.equal(bodyViewGeometry(p,Math.sin(diameter/2),c,w,h),null);
 }
});

test('camera-plane/behind-camera/full-offscreen bodies have no quad or false hit, including deep zoom',()=>{
 for(const fovDeg of [.0001,70,110])for(const [w,h]of [[1440,900],[390,844]]){
  const c={azimuthDeg:0,altitudeDeg:0,fovDeg},diameter=.55*RAD;
  for(const az of [89.999,90,90.001,100,180,260,269.999,270,270.001]){
   const p=horizontalDirection(az,0);assert.equal(bodyViewGeometry(p,Math.sin(diameter/2),c,w,h),null,`${fovDeg}/${az}`);
   assert.equal(bodyDiskContains(p,diameter,c,w,h,w/2,h/2),false);
  }
  for(const p of [[1,0,0],[0,1,0],[0,0,0],[NaN,0,-1],[Infinity,0,-1]] as Vec3[])assert.equal(bodyViewGeometry(p,Math.sin(diameter/2),c,w,h),null);
  for(const [nx,ny]of [[2,0],[-2,0],[0,2],[0,-2]]){
   const p=ndcDirection(nx,ny,c,w,h),d=fovDeg*.1*RAD;assert.equal(bodyViewGeometry(p,Math.sin(d/2),c,w,h),null);
  }
 }
});

test('all 9 scientific disks retain diameter, magnitude, phase, distance and centered optical scale off axis',()=>{
 const state=computeSky(new Date('2026-10-14T00:44:00Z'),DEFAULT_LOCATION),before=JSON.stringify(state);
 assert.equal(state.bodies.length,9);
 for(const b of state.bodies)for(const [w,h]of [[1440,900],[390,844]]){
  const fovDeg=bodyInspectionFov(b.angularDiameterRad,w,h),c={azimuthDeg:0,altitudeDeg:0,fovDeg};
  for(const [nx,ny]of sites){const p=ndcDirection(nx,ny,c,w,h),g=geometry(p,b.angularDiameterRad,c,w,h);
   near(g.radiusCssPixels,Math.min(w,h)*.225,1e-8);
   near(g.radiusCssPixels,angularDiameterCssPixels(b.angularDiameterRad,fovDeg,h)/2,1e-8);
  }
  for(const fovDeg of [.0001,70,110]){
   const c={azimuthDeg:b.azimuthDeg,altitudeDeg:b.altitudeDeg,fovDeg},g=geometry(b.direction,b.angularDiameterRad,c,w,h);
   near(g.radiusCssPixels,angularDiameterCssPixels(b.angularDiameterRad,fovDeg,h)/2,1e-8);
  }
 }
 assert.equal(JSON.stringify(state),before,'render geometry must not mutate scientific state');
});

test('local body basis equals independent shortest-arc transport and stays orthonormal',()=>{
 for(const altitudeDeg of [-90,-89.999,-30,0,50,89.999,90])for(const azimuthDeg of [0,127,359.999])for(const [nx,ny]of sites){
  const c={azimuthDeg,altitudeDeg,fovDeg:110},b=cameraBasis(c),p=ndcDirection(nx,ny,c,1440,900),g=geometry(p,.55*RAD,c,1440,900);
  const v=cross(b.forward,p),cos=dot(b.forward,p);
  const rotate=(a:Vec3)=>add(a,add(cross(v,a),mul(cross(v,cross(v,a)),1/(1+cos))));
  nearVec(g.right,rotate(b.right));nearVec(g.up,rotate(b.up));nearVec(g.forward,p);
  for(const a of [g.right,g.up,g.forward])near(dot(a,a),1);
  near(dot(g.right,g.up),0);near(dot(g.right,g.forward),0);near(dot(g.up,g.forward),0);
  nearVec(sample(g,.55*RAD,0,0)!.normal,mul(p,-1));
 }
});

test('transported sphere normals preserve physical phase area and illumination rather than masking an ellipse',()=>{
 const c={azimuthDeg:137,altitudeDeg:22,fovDeg:110},diameter=.55*RAD;
 for(const [nx,ny]of sites)for(const fraction of [.05,.25,.5,.75,.95]){
  const p=ndcDirection(nx,ny,c,1440,900),g=geometry(p,diameter,c,1440,900),z=1-2*fraction;
  const light=add(mul(g.forward,z),mul(g.right,Math.sqrt(1-z*z)));
  near(projectedIlluminatedFraction(p,light),fraction);
  let lit=0,total=0;
  for(let iy=-60;iy<=60;iy++)for(let ix=-60;ix<=60;ix++){
   const hit=sample(g,diameter,ix/60,iy/60);if(!hit)continue;
   if(dot(hit.normal,light)>0)lit++;total++;
   assert.ok(dot(hit.normal,mul(hit.ray,-1))>=-1e-10,'near hemisphere, no inverted surface');
  }
  // Small finite-distance perspective and a sampled boundary, not a changed
  // scientific phase. The real shader retains physical target-to-Sun lighting.
  near(lit/total,fraction,.006);
 }
 assert.match(BODY_FRAG,/u_bodyRight\*nLocal\.x\+u_bodyUp\*nLocal\.y\+u_bodyForward\*nLocal\.z/);
 assert.match(BODY_FRAG,/u_normalToGeometric\*nApparent/);
 assert.match(BODY_FRAG,/dot\(n,normalize\(u_light\)\)/);
 assert.match(BODY_FRAG,/textureGrad\(u_texture,uv,uvDx,uvDy\)/);
});

test('surface texture direction is continuous across camera meridian, center, and polar neighborhoods',()=>{
 const diameter=.5*RAD,p=horizontalDirection(0,25);
 const north:Vec3=[0,1,0],prime:Vec3=[1,0,0],east:Vec3=[0,0,1];
 let previous:Vec3|undefined,previousUV:number[]|undefined;
 for(let i=0;i<=600;i++){
  const c={azimuthDeg:(330+i*.1)%360,altitudeDeg:25+10*Math.sin(i/600*Math.PI*2),fovDeg:110},g=geometry(p,diameter,c,1200,800),hit=sample(g,diameter,.35,.2)!;
  const uv=[.5+Math.atan2(dot(hit.normal,east),dot(hit.normal,prime))/(2*Math.PI),Math.acos(dot(hit.normal,north))/Math.PI];
  if(previous){assert.ok(Math.hypot(...hit.normal.map((v,j)=>v-previous![j]))<.002);const du=uv[0]-previousUV![0];assert.ok(Math.abs(du-Math.round(du))<.001);assert.ok(Math.abs(uv[1]-previousUV![1])<.001);}
  previous=hit.normal;previousUV=uv;
 }
 // Basis has no extra pole chosen by a world-up lookAt constructor.
 for(const altitudeDeg of [-89.999,89.999]){
  const c={azimuthDeg:1,altitudeDeg,fovDeg:110},p=horizontalDirection(35,altitudeDeg),g=geometry(p,diameter,c,1200,800);
  const next=geometry(p,diameter,{...c,altitudeDeg:altitudeDeg+.000001},1200,800);
  nearVec(g.right,next.right,1e-6);nearVec(g.up,next.up,1e-6);
 }
});
