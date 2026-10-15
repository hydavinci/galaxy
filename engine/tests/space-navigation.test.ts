import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Navigation, COLLISION_RADIUS_RATIO } from '../src/space/navigation';
import { computeSpace, observeBody } from '../src/space/world';
import { AU_KM, PARSEC_AU, type CatalogStar3D, type Vec3 } from '../src/space/types';
import { add, cameraBasis, directionAngles, distance, dot, length, normalize, scale, subtract } from '../src/space/math';
const date=new Date('2026-10-14T00:00:00Z'),snapshot=computeSpace(date),earth=snapshot.bodies.find(b=>b.id==='earth')!;
const near=(a:number,b:number,tol=1e-12)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}, tolerance ${tol}`);
const outside=(nav:Navigation)=>snapshot.bodies.forEach(b=>assert.ok(distance(nav.view.camera.positionAU,b.positionAU)>=b.radiusKm/AU_KM*COLLISION_RADIUS_RATIO*(1-1e-8),`${b.id} collision`));
const finish=(nav:Navigation)=>{for(let i=0;i<300&&nav.isFlying;i++){nav.update(1/60);outside(nav);}assert.equal(nav.isFlying,false);};
const star:CatalogStar3D={id:'hyg:alpha',name:'Test nearby catalog fixture',sourceId:'fixture',positionAU:[-1.2*PARSEC_AU,.4*PARSEC_AU,0],absoluteMagnitude:4.3,bv:.7,distancePc:Math.hypot(1.2,.4)};

test('initial Earth shares all 10 bodies and camera is 4.5 radii, daylit oblique, FOV60',()=>{
  const nav=new Navigation(snapshot),view=nav.view,info=nav.getSelectedInfo()!;assert.equal(view.selectedId,'earth');assert.equal(view.mode,'orbit');assert.equal(view.camera.fovDeg,60);
  near(info.distanceAU/(earth.radiusKm/AU_KM),4.5,1e-10);assert.ok(info.illuminatedFraction!>.85&&info.illuminatedFraction!<.99);
  const forward=cameraBasis(view.camera).forward;near(dot(forward,normalize(subtract(earth.positionAU,view.camera.positionAU))),1);outside(nav);
});

test('dolly translates AU at fixed FOV and geometric disk diameter changes',()=>{
  const nav=new Navigation(snapshot),before=nav.view,diameter=nav.getSelectedInfo()!.angularDiameterRad!;nav.dolly(.7);
  assert.ok(distance(before.camera.positionAU,nav.view.camera.positionAU)>1e-5);assert.equal(nav.view.camera.fovDeg,before.camera.fovDeg);
  near(nav.getSelectedInfo()!.distanceAU,distance(before.camera.positionAU,earth.positionAU)*.7);
  assert.ok(nav.getSelectedInfo()!.angularDiameterRad!>diameter);outside(nav);
  nav.dolly(100);assert.ok(nav.getSelectedInfo()!.angularDiameterRad!<diameter);assert.equal(nav.view.camera.fovDeg,60);
});

test('orbit changes world camera around finite center, preserves radius and changes sunlit phase',()=>{
  const nav=new Navigation(snapshot),start=nav.view.camera.positionAU,d=nav.getSelectedInfo()!.distanceAU,phase=nav.getSelectedInfo()!.illuminatedFraction!;
  nav.orbit(600,0,600,400);near(nav.getSelectedInfo()!.distanceAU,d);assert.ok(distance(start,nav.view.camera.positionAU)>d);
  assert.ok(phase-nav.getSelectedInfo()!.illuminatedFraction!>.65);assert.equal(nav.view.camera.fovDeg,60);outside(nav);
});

test('W/A translations and look are real world movement, not yaw-only or FOV scaling',()=>{
  const nav=new Navigation(snapshot),before=nav.view;nav.update(.05,new Set(['KeyW']));const w=nav.view;
  assert.equal(w.mode,'free');assert.ok(distance(w.camera.positionAU,before.camera.positionAU)>0);assert.equal(w.camera.fovDeg,60);
  near(dot(normalize(subtract(w.camera.positionAU,before.camera.positionAU)),cameraBasis(before.camera).forward),1);
  nav.update(.05,new Set(['KeyA']));const a=nav.view;
  near(dot(normalize(subtract(a.camera.positionAU,w.camera.positionAU)),cameraBasis(w.camera).right),-1);assert.equal(a.camera.fovDeg,60);
  nav.look(50,-25,600,400);assert.deepEqual(nav.view.camera.positionAU,a.camera.positionAU);assert.notEqual(nav.view.camera.azimuthDeg,a.camera.azimuthDeg);
});

test('DOM event adapter fixture: keydown W/A and wheel move AU; keyup stops, FOV unchanged',()=>{
  // This tests event→pure Navigation integration, NOT the parent actual app DOM
  // or browser GPU. Parent performs its actual bundle/UI acceptance separately.
  const window=new Window(),nav=new Navigation(snapshot),keys=new Set<string>();
  const down=(e:Event)=>keys.add((e as unknown as KeyboardEvent).code),up=(e:Event)=>keys.delete((e as unknown as KeyboardEvent).code);
  const wheel=(e:Event)=>nav.dolly(Math.exp((e as unknown as WheelEvent).deltaY*.001));
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('wheel',wheel);
  let p=nav.view.camera.positionAU;
  for(const code of ['KeyW','KeyA']){
    window.dispatchEvent(new window.KeyboardEvent('keydown',{code}));nav.update(.05,keys);assert.ok(distance(p,nav.view.camera.positionAU)>0);p=nav.view.camera.positionAU;
    window.dispatchEvent(new window.KeyboardEvent('keyup',{code}));nav.update(.05,keys);assert.deepEqual(nav.view.camera.positionAU,p);
  }
  window.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-120}));assert.ok(distance(p,nav.view.camera.positionAU)>0);assert.equal(nav.view.camera.fovDeg,60);
  window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('wheel',wheel);nav.dispose();window.happyDOM.abort();
});

test('diagonal keys normalize speed and explicit local movement equals update keys',()=>{
  const one=new Navigation(snapshot),two=new Navigation(snapshot),three=new Navigation(snapshot);[one,two,three].forEach(n=>n.setSpeed(1e-6));const start=one.view.camera.positionAU;
  one.update(.1,new Set(['KeyW','KeyD']));two.move([1,0,1],.1);three.update(.1,new Set(['KeyW']));
  assert.deepEqual(one.view.camera.positionAU,two.view.camera.positionAU);near(distance(start,one.view.camera.positionAU),distance(start,three.view.camera.positionAU));
  const before=two.view.camera.positionAU;two.update(.1);assert.deepEqual(before,two.view.camera.positionAU);
});

for(const id of snapshot.bodies.map(b=>b.id))test(`bounded collision-safe flyto ${id} converges without FOV collapse`,()=>{
  const nav=new Navigation(snapshot);assert.ok(nav.selectTarget(id));finish(nav);assert.equal(nav.view.selectedId,id);
  const body=snapshot.bodies.find(b=>b.id===id)!,expected=body.radiusKm/AU_KM*(id==='saturn'?7:4.5);
  near(nav.getSelectedInfo()!.distanceAU,expected,2e-11);assert.equal(nav.view.camera.fovDeg,60);outside(nav);
});

test('Earth→Moon→Neptune→Earth flights all terminate with stable geometry',()=>{
  const nav=new Navigation(snapshot);
  for(const id of ['moon','neptune','earth','saturn','mercury','earth']){
    nav.selectTarget(id);finish(nav);assert.ok(nav.getSelectedInfo()!.angularDiameterRad!>.1);outside(nav);
  }
});

test('swept collision guard prevents high-speed tunneling, point-at-center recovers safely',()=>{
  const nav=new Navigation(snapshot),r=earth.radiusKm/AU_KM;nav.setCamera({...nav.camera,positionAU:add(earth.positionAU,[0,0,4.5*r]),azimuthDeg:0,altitudeDeg:0});
  nav.setSpeed(1000);nav.move([0,0,1],.25,true);outside(nav);const delta=subtract(nav.camera.positionAU,earth.positionAU);assert.ok(delta[2]>0);near(length(delta)/r,1.05,1e-5);
  nav.setCamera({...nav.camera,positionAU:[...earth.positionAU]});outside(nav);assert.ok(nav.getSelectedInfo()!.altitudeAU!>0);
  nav.setMode('orbit');for(let i=0;i<50;i++)nav.dolly(.01);outside(nav);
});

test('orbit follows only target ephemeris delta; free camera remains world-fixed across time',()=>{
  const nav=new Navigation(snapshot),before=subtract(nav.camera.positionAU,earth.positionAU),next=computeSpace(new Date('2026-10-15T00:00:00Z'));
  nav.setSnapshot(next);const nextEarth=next.bodies.find(b=>b.id==='earth')!;assert.ok(distance(earth.positionAU,nextEarth.positionAU)>.01);
  near(distance(subtract(nav.camera.positionAU,nextEarth.positionAU),before),0);assert.equal(nav.camera.fovDeg,60);
  nav.setMode('free');const fixed=nav.camera.positionAU;nav.setSnapshot(computeSpace(new Date('2026-10-16T00:00:00Z')));assert.deepEqual(nav.camera.positionAU,fixed);
});

test('orbit target following during flyto carries path and still converges',()=>{
  const nav=new Navigation(snapshot);nav.selectTarget('neptune');nav.update(.1);const later=computeSpace(new Date('2027-10-14T00:00:00Z'));
  nav.setSnapshot(later);for(let i=0;i<250&&nav.isFlying;i++)nav.update(1/60);assert.equal(nav.isFlying,false);
  const n=later.bodies.find(b=>b.id==='neptune')!;near(nav.getSelectedInfo()!.distanceAU,4.5*n.radiusKm/AU_KM,2e-11);
});

test('finite catalog star flyto keeps safe stand-off without claiming radius/surface',()=>{
  const nav=new Navigation(snapshot,[star,{...star,id:'bad',positionAU:[NaN,0,0]},{...star,id:'unknown',distancePc:0}]);
  assert.equal(nav.selectTarget('bad'),false);assert.equal(nav.selectTarget('unknown'),false);assert.equal(nav.selectTarget(star.id),true);finish(nav);
  near(nav.getSelectedInfo()!.distanceAU,200,1e-8);assert.equal(nav.getSelectedInfo()!.radiusAU,null);assert.equal(nav.getSelectedInfo()!.angularDiameterRad,null);
  nav.dolly(.001);assert.ok(nav.getSelectedInfo()!.distanceAU>=100);assert.equal(nav.camera.fovDeg,60);
  nav.setMode('free');nav.setSpeed(1000);nav.move([0,0,-1],.25);assert.ok(length(nav.camera.positionAU)>PARSEC_AU);
});

test('free interstellar precision domain is finite, not Earth field-of-view restricted',()=>{
  const nav=new Navigation(snapshot);nav.setMode('free');nav.setCamera({...nav.camera,positionAU:[1e9,-1e9,1e9]});nav.setSpeed(1e9);nav.move([1,0,0],.25,true);
  assert.ok(nav.camera.positionAU.every(Number.isFinite));assert.equal(nav.view.speedAUPerSecond,1000);assert.equal(nav.camera.fovDeg,60);
  assert.throws(()=>nav.setCamera({...nav.camera,positionAU:[1e13,0,0]}),RangeError);
});

test('adaptive speed scales altitude; explicit speed/ratio and frame reset are bounded',()=>{
  const nav=new Navigation(snapshot),slow=nav.view.speedAUPerSecond;nav.dolly(10);assert.ok(nav.view.speedAUPerSecond>slow*5);
  nav.setSpeed(1e-30);assert.equal(nav.view.speedAUPerSecond,1e-10);nav.setSpeedMultiplier(2);assert.ok(nav.view.speedAUPerSecond>slow);
  nav.frameSystem();near(length(nav.camera.positionAU),40);assert.equal(nav.view.mode,'free');assert.equal(nav.view.selectedId,'sun');
  nav.resetEarth();near(nav.getSelectedInfo()!.distanceAU,4.5*earth.radiusKm/AU_KM);assert.equal(nav.camera.fovDeg,60);
});

test('finite input guards, defensive view copies and manual cancellation',()=>{
  const nav=new Navigation(snapshot),view=nav.view;view.camera.positionAU[0]=100;assert.notDeepEqual(view,nav.view);
  for(const fn of [()=>nav.update(NaN),()=>nav.move([Infinity,0,0],.1),()=>nav.dolly(0),()=>nav.dolly(Infinity),()=>nav.setSpeed(-1),()=>nav.setSpeedRatio(NaN),()=>nav.orbit(1,1,0,100)])assert.throws(fn,RangeError);
  nav.selectTarget('moon');assert.equal(nav.isFlying,true);nav.look(1,1,100,100);assert.equal(nav.isFlying,false);assert.equal(nav.view.mode,'free');
  const p=nav.camera.positionAU;nav.selectTarget('earth',false);assert.deepEqual(nav.camera.positionAU,p);assert.equal(nav.isFlying,false);
  nav.selectTarget('moon');nav.stop();assert.equal(nav.isFlying,false);
});

test('blocked night-side Earth→Sun flight detours around Earth rather than crossing it',()=>{
  const nav=new Navigation(snapshot);nav.setCamera({...nav.camera,positionAU:add(earth.positionAU,scale(normalize(earth.positionAU),4.5*earth.radiusKm/AU_KM))});
  nav.selectTarget('sun');finish(nav);near(nav.getSelectedInfo()!.distanceAU,snapshot.bodies[0].radiusKm/AU_KM*4.5);
});

test('catalog star at camera position can be selected/flown/orbited without zero-vector failure',()=>{
  const nav=new Navigation(snapshot),atCamera={...star,id:'at-camera',positionAU:nav.camera.positionAU};nav.setStars([atCamera]);
  nav.selectTarget(atCamera.id);finish(nav);near(nav.getSelectedInfo()!.distanceAU,200,1e-9);
  nav.orbit(50,30,600,400);near(nav.getSelectedInfo()!.distanceAU,200,1e-9);
});

for(const year of [1900,2026,2100])test(`100 deterministic target transfer legs converge at epoch ${year}`,()=>{
  const s=computeSpace(new Date(`${year}-10-14T00:00:00Z`));let count=0;
  for(const source of s.bodies){
    const nav=new Navigation(s);nav.selectTarget(source.id);for(let i=0;i<300&&nav.isFlying;i++)nav.update(1/60);
    for(const body of s.bodies){
      nav.selectTarget(source.id);for(let i=0;i<300&&nav.isFlying;i++)nav.update(1/60);
      nav.selectTarget(body.id);for(let i=0;i<300&&nav.isFlying;i++)nav.update(1/60);
      assert.equal(nav.isFlying,false);near(nav.getSelectedInfo()!.distanceAU,body.radiusKm/AU_KM*(body.id==='saturn'?7:4.5),1e-10);count++;
    }
  }
  assert.equal(count,100);
});
