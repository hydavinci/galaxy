import test from 'node:test';
import assert from 'node:assert/strict';
import {computeSky,DEFAULT_LOCATION} from '../src/observer/astronomy';
import {bodyInspectionFov} from '../src/observer/allsky';
import {ViewController,angleDelta} from '../src/observer/controls';
import {MIN_FOV_DEG,MAX_FOV_DEG,INSPECTION_FRACTION,clampFov,formatFov} from '../src/observer/zoom';
import {angularDiameterCssPixels,bodyDiskContains,bodyViewGeometry,horizontalDirection,projectDirection} from '../src/observer/sky-renderer';
import {BODY_FRAG} from '../src/observer/shaders/sky';
const RAD=Math.PI/180;
const near=(a:number,b:number,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const state=computeSky(new Date('2026-10-13T15:52:00Z'),DEFAULT_LOCATION);
for(const [w,h] of [[1440,900],[390,844],[844,390],[320,320]])test(`all 9 real disks auto-frame to 45% of short side at ${w}x${h}`,()=>{
 assert.equal(state.bodies.length,9);
 for(const b of state.bodies){
  const fov=bodyInspectionFov(b.angularDiameterRad,w,h),c={azimuthDeg:b.azimuthDeg,altitudeDeg:b.altitudeDeg,fovDeg:fov};
  near(angularDiameterCssPixels(b.angularDiameterRad,fov,h),Math.min(w,h)*INSPECTION_FRACTION);
  const p=projectDirection(b.direction,c,w,h);assert.equal(p.visible,true,b.id);near(p.x,w/2,1e-4);near(p.y,h/2,1e-4);
  assert.ok(bodyViewGeometry(b.direction,Math.sin(b.angularDiameterRad/2),c,w,h),b.id);
 }
});
test('bounded scientific epoch scan: even smallest outer/inner planets frame without touching zoom floor',()=>{
 const minimum=new Map<string,number>();
 // Sampling, not a proof of continuous extrema: 1900..2100, quarterly per decade.
 for(let year=1900;year<=2100;year+=10)for(const month of [0,3,6,9]){
  const s=computeSky(new Date(Date.UTC(year,month,1)),DEFAULT_LOCATION);
  for(const b of s.bodies){minimum.set(b.id,Math.min(minimum.get(b.id)??Infinity,b.angularDiameterRad));
   const fov=bodyInspectionFov(b.angularDiameterRad);assert.ok(fov>MIN_FOV_DEG&&fov<MAX_FOV_DEG,b.id);
   near(angularDiameterCssPixels(b.angularDiameterRad,fov,1000),450);
   assert.ok(angularDiameterCssPixels(b.angularDiameterRad,MIN_FOV_DEG,1000)>1000,b.id);
  }
 }
 assert.ok(minimum.get('neptune')!*180/Math.PI*3600<2.4);
});
test('all zoom routes share a 0.36 arcsecond to 110 degree camera range',()=>{
 assert.equal(MIN_FOV_DEG,.0001);assert.equal(MAX_FOV_DEG,110);
 const v=new ViewController();v.zoom(1e-20);assert.equal(v.camera.fovDeg,MIN_FOV_DEG);v.zoom(1e20);assert.equal(v.camera.fovDeg,MAX_FOV_DEG);
 v.reducedMotion=true;v.goTo(10,20,1e-10);v.update(.016);assert.equal(v.camera.fovDeg,MIN_FOV_DEG);
 for(const factor of [NaN,Infinity,0,-1]){v.zoom(factor);assert.equal(v.camera.fovDeg,MIN_FOV_DEG);}
 assert.equal(clampFov(200),MAX_FOV_DEG);
});
test('FOV readout is meaningful throughout deep zoom, never 0.0 degrees',()=>{
 assert.equal(formatFov(MIN_FOV_DEG),'0.36″');assert.equal(formatFov(.001),'3.60″');assert.equal(formatFov(.1),'6.00′');assert.equal(formatFov(1.234),'1.23°');assert.equal(formatFov(110),'110.0°');
});
test('sub-arcsecond goto converges without a 54 arcsecond snap threshold',()=>{
 const v=new ViewController();v.camera={azimuthDeg:20,altitudeDeg:30,fovDeg:.0001};v.goTo(20.001,30.001,.0001);v.update(.016);
 assert.ok(v.target,'still slewing: 0.015 degrees is much wider than this view');
 for(let i=0;i<300;i++)v.update(1/60);
 assert.equal(v.target,null);near(v.camera.azimuthDeg,20.001);near(v.camera.altitudeDeg,30.001);
});
test('a moving tracked target carries the slew and subsequently locks without low-pass lag',()=>{
 const v=new ViewController();v.goTo(359,30,.0001);
 for(let i=0;i<400;i++){v.follow(359+i*.001,30+i*.0001);v.update(1/60);}
 assert.equal(v.target,null);near(angleDelta(v.camera.azimuthDeg,359.399),0);near(v.camera.altitudeDeg,30.0399);
 v.follow(.0001,-89.9999);v.update(.016);near(v.camera.azimuthDeg,.0001);near(v.camera.altitudeDeg,-89.9999);assert.equal(v.camera.fovDeg,.0001);
});
test('deep manual panning is proportional to the viewport, including near-polar altitude',()=>{
 for(const altitudeDeg of [0,60,89.5]){
  const v=new ViewController();v.camera={azimuthDeg:120,altitudeDeg,fovDeg:.001};const p=horizontalDirection(120,altitudeDeg);
  v.move(30,0,800,1/60);const projected=projectDirection(p,v.camera,1200,800);near(projected.x,630,.02);
 }
});
test('circular optical disk picking reaches limbs beyond 25px and rejects just outside them',()=>{
 for(const b of state.bodies){const c={azimuthDeg:b.azimuthDeg,altitudeDeg:b.altitudeDeg,fovDeg:bodyInspectionFov(b.angularDiameterRad,1200,800)};
  assert.equal(bodyDiskContains(b.direction,b.angularDiameterRad,c,1200,800,760,400),true,b.id);
  assert.equal(bodyDiskContains(b.direction,b.angularDiameterRad,c,1200,800,790,400),false,b.id);
 }
});
test('large offscreen foreground disk intersects viewport and is pickable without its center',()=>{
 const c={azimuthDeg:0,altitudeDeg:0,fovDeg:.01},moon=horizontalDirection(.15,0),diameter=.5*RAD;
 assert.equal(projectDirection(moon,c,1200,800).visible,false);
 assert.ok(bodyViewGeometry(moon,Math.sin(diameter/2),c,1200,800));assert.equal(bodyDiskContains(moon,diameter,c,1200,800,600,400),true);
});
test('off-screen and behind-camera Sun-sized disks never acquire spurious screen-filling bounds',()=>{
 const c={azimuthDeg:0,altitudeDeg:0,fovDeg:MIN_FOV_DEG},radius=Math.sin(.55*RAD/2);
 for(const az of [1,45,89.9,90,90.2,100,180,270,359]){
  const p=horizontalDirection(az,0);assert.equal(bodyViewGeometry(p,radius,c,1200,800),null,`${az}`);assert.equal(bodyDiskContains(p,.55*RAD,c,1200,800,600,400),false);
 }
});
test('surface shader intersects body-local rays without subtracting almost-unit world positions',()=>{
 // The former camera-local/off-axis pinhole sphere was correctly an ellipse.
 // The requested display contract is now a recentered circular optical window;
 // retain the stable cross-product intersection, not the old elliptical mapping.
 assert.match(BODY_FRAG,/\(v_ndc-u_centerNdc\)\*u_tanFov/);
 assert.match(BODY_FRAG,/cross\(rayLocal,cross\(rayLocal,vec3\(0\.0,0\.0,1\.0\)\)\)/);
 assert.match(BODY_FRAG,/closest-rayLocal\*sqrt\(discriminant\)/);
 assert.doesNotMatch(BODY_FRAG,/ray\*t-u_center|uniform vec3 u_centerView/);
});

// Independent QA's wide-field polar regression: inverse cos alone is singular.
test('QA-3: wide sky 1px polar pan never spins a visible field by tens of degrees',()=>{
 for(const fovDeg of [70,110])for(const altitudeDeg of [-90,-89.999,-89.5,89.5,89.999,90])for(const azimuthDeg of [0,359.999]){
  const v=new ViewController();v.camera={azimuthDeg,altitudeDeg,fovDeg};
  const body=horizontalDirection(azimuthDeg,Math.sign(altitudeDeg)*60),before=projectDirection(body,v.camera,960,600);
  v.move(1,0,600,1/60);const after=projectDirection(body,v.camera,960,600);
  assert.ok(Math.abs(angleDelta(v.camera.azimuthDeg,azimuthDeg))<.4,`bounded angular pan ${fovDeg}/${altitudeDeg}`);
  assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<1.5,`bounded visible motion ${fovDeg}/${altitudeDeg}`);
  assert.ok(Math.abs(v.velocityAz)<24,'no huge spin impulse');
 }
});
test('QA-3: exact/near-pole panning and wrap stay finite over the complete optical range',()=>{
 for(const fovDeg of [.0001,.001,.1,1,10,70,110])for(const altitudeDeg of [-90,-89.999999,89.999999,90])for(const azimuthDeg of [.00001,359.99999]){
  const v=new ViewController();v.camera={azimuthDeg,altitudeDeg,fovDeg};
  const target=horizontalDirection(azimuthDeg,Math.sign(altitudeDeg)*(90-fovDeg*.3)),before=projectDirection(target,v.camera,960,600);
  for(const dx of [1,-1]){v.move(dx,0,600,1/60);assert.ok(Number.isFinite(v.camera.azimuthDeg)&&v.camera.azimuthDeg>=0&&v.camera.azimuthDeg<360);assert.ok(Math.abs(angleDelta(v.camera.azimuthDeg,azimuthDeg))<.5);}
  const after=projectDirection(target,v.camera,960,600);near(after.x,before.x,1e-4);near(after.y,before.y,1e-4);
 }
});
test('QA-3: polar drag inertia is bounded and frame-rate independent after release',()=>{
 for(const fovDeg of [.0001,.001,70,110])for(const altitudeDeg of [-90,89.999999,90]){
  const a=new ViewController(),b=new ViewController();a.camera={azimuthDeg:.0001,altitudeDeg,fovDeg};b.camera={...a.camera};
  a.move(1,0,600,1/60);b.move(1,0,600,1/60);
  const impulse=Math.abs(a.velocityAz);assert.ok(impulse<24);
  const az=a.camera.azimuthDeg;for(let i=0;i<60;i++)a.update(1/60);for(let i=0;i<120;i++)b.update(1/120);
  near(angleDelta(a.camera.azimuthDeg,b.camera.azimuthDeg),0,1e-8);assert.ok(Math.abs(angleDelta(a.camera.azimuthDeg,az))<3);assert.ok(Math.abs(a.velocityAz)<impulse*.001);
  a.stop();const stopped={...a.camera};a.update(.1);assert.deepEqual(a.camera,stopped);
 }
});
