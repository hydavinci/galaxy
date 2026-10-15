import assert from 'node:assert/strict';
import test from 'node:test';
import { Navigation, COLLISION_RADIUS_RATIO } from '../src/space/navigation';
import { cameraBasis, distance, dot, faceCamera, length, rotateCamera } from '../src/space/math';
import { bodyFrame, bodyHitDistance, projectSpace, spaceCameraBasis, validCamera } from '../src/space/render-math';
import { focusSizeCssPixels, focusTicks } from '../src/space/focus';
import { SpaceRenderer } from '../src/space/renderer';
import { computeSpace } from '../src/space/world';
import { AU_KM, type CatalogStar3D, type SpaceBody, type SpaceCamera, type SpaceSnapshot, type Vec3 } from '../src/space/types';
import { recordingCanvas } from './space-renderer-harness';

const D=Math.PI/180,W=900,H=600,R=.001;
const near=(a:number,b:number,t=2e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}; tolerance ${t}`);
const vnear=(a:Vec3,b:Vec3,t=2e-10)=>a.forEach((v,i)=>near(v,b[i],t));
const planet=(id:string,positionAU:Vec3,radiusKm=6378.137):SpaceBody=>({id,name:id,nameEn:id,positionAU,radiusKm,kind:'planet',textureId:id,color:'#80a0ff',axisPrime:[1,0,0],axisNorth:[0,1,0],axisEast:[0,0,1]});
const earth=planet('earth',[0,0,0]),snapshot:SpaceSnapshot={date:new Date('2026-10-14T00:00:00Z'),bodies:[earth,planet('sun',[100,0,0],695700)]};
const initial:SpaceCamera={positionAU:[0,0,R],azimuthDeg:0,altitudeDeg:0,fovDeg:60};
function fixture(mode:'free'|'orbit'='orbit'){const n=new Navigation(snapshot);n.setCamera(initial);n.setMode(mode);return n;}
function drag(n:Navigation,mode:'free'|'orbit',h:number,v:number){if(mode==='free')n.look(h*H/60,v*H/60,W,H);else n.orbit(-h*W/180,-v*H/180,W,H);}

// Independent oracle: Hamilton products, not production trigonometric direction,
// branch conversion, Rodrigues rotation or shared renderer cameraBasis.
type Q=[number,number,number,number];
const mul=(a:Q,b:Q):Q=>[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
function qdrag(h:number,v:number):Q{const angle=Math.hypot(h,v);if(!angle)return [1,0,0,0];const s=Math.sin(angle*D/2)/angle;return [Math.cos(angle*D/2),v*s,h*s,0];}
function qvector(q:Q,v:Vec3):Vec3{const p=mul(mul(q,[0,...v]),[q[0],-q[1],-q[2],-q[3]]);return [p[1],p[2],p[3]];}
const qbasis=(q:Q)=>({right:qvector(q,[1,0,0]),up:qvector(q,[0,1,0]),forward:qvector(q,[0,0,-1])});
function basisNear(camera:SpaceCamera,q:Q,t=2e-10){const b=cameraBasis(camera),e=qbasis(q);for(const key of ['right','up','forward'] as const){vnear(b[key],e[key],t);vnear(spaceCameraBasis(camera)[key],e[key],t);near(length(b[key]),1,1e-12);}near(dot(b.right,b.up),0,1e-12);near(dot(b.right,b.forward),0,1e-12);near(dot(b.up,b.forward),0,1e-12);}

for(const mode of ['free','orbit'] as const)for(const sign of [-1,1])test(`${mode}: ${sign>0?'+':'-'}720 degrees in 0.5-degree drags crosses every pole/wrap continuously`,()=>{
 const n=fixture(mode),position=n.camera.positionAU;let previous=cameraBasis(n.camera);
 for(let i=1;i<=1440;i++){
  drag(n,mode,0,sign*.5);const angle=sign*i*.5,b=cameraBasis(n.camera);basisNear(n.camera,qdrag(0,angle));
  vnear(b.right,previous.right,2e-10);near(dot(b.forward,previous.forward),Math.cos(.5*D),2e-12);near(dot(b.up,previous.up),Math.cos(.5*D),2e-12);previous=b;
  if(mode==='free')assert.deepEqual(n.camera.positionAU,position);else {vnear(n.camera.positionAU,[0,-R*Math.sin(angle*D),R*Math.cos(angle*D)],2e-13);near(length(n.camera.positionAU),R,2e-13);const p=projectSpace(earth.positionAU,n.camera,W,H);near(p.x,W/2,2e-8);near(p.y,H/2,2e-8);assert.ok(p.visible);}
  if(i%180===0)assert.ok(validCamera(n.camera),`landmark ${angle}`);
 }
 basisNear(n.camera,[1,0,0,0]);assert.equal(n.camera.fovDeg,60);
});

for(const mode of ['free','orbit'] as const)test(`${mode}: large pure and mixed-axis drags equal 720 subdivisions, including multiple turns`,()=>{
 for(const [h,v] of [[0,720],[0,-1080],[144,-672],[-245,765],[3600,7200]]){
  const a=fixture(mode),b=fixture(mode);drag(a,mode,h,v);for(let i=0;i<720;i++)drag(b,mode,h/720,v/720);
  basisNear(a.camera,qdrag(h,v));basisNear(b.camera,qdrag(h,v));
  vnear(a.camera.positionAU,b.camera.positionAU,2e-13);
 }
});

for(const mode of ['free','orbit'] as const)test(`${mode}: screen-horizontal input retains its sign and full response at both poles and upside down`,()=>{
 for(const pitch of [-450,-270,-180,-90,90,180,270,450]){
  const n=fixture(mode);drag(n,mode,0,pitch);const before=cameraBasis(n.camera);drag(n,mode,7,0);
  basisNear(n.camera,mul(qdrag(0,pitch),qdrag(7,0)));
  near(dot(cameraBasis(n.camera).forward,before.right),-Math.sin(7*D));
  near(dot(cameraBasis(n.camera).forward,before.up),0);
  // Move in the new screen frame, including its transported (possibly inverted) up.
  n.setSpeed(1e-6);const p=n.camera.positionAU,b=cameraBasis(n.camera);n.move([0,1,0],.1);vnear(n.camera.positionAU,p.map((x,i)=>x+b.up[i]*1e-7) as Vec3,1e-14);
 }
});

test('mixed-axis 2000-event path remains an orthonormal frame matching an independent quaternion oracle',()=>{
 const n=fixture('free');let q:Q=[1,0,0,0];
 for(let i=0;i<2000;i++){const h=Math.sin(i*.731)*3,v=Math.cos(i*.193)*4;drag(n,'free',h,v);q=mul(q,qdrag(h,v));if(i%11===0)basisNear(n.camera,q,3e-10);}
 basisNear(n.camera,q,3e-10);assert.deepEqual(n.camera.positionAU,initial.positionAU);
});

test('zero drag, stationary update, same snapshot, dolly and free/orbit transitions never restore upright',()=>{
 for(const pitch of [-270,-180,-90,90,180,270]){
  const n=fixture();drag(n,'orbit',0,pitch);drag(n,'orbit',17,9);const expected=cameraBasis(n.camera),position=n.camera.positionAU;
  const stable=()=>{const b=cameraBasis(n.camera);for(const k of ['forward','right','up'] as const)vnear(b[k],expected[k],2e-11);};
  for(let i=0;i<120;i++){n.update(1/60);n.setSnapshot(snapshot);n.orbit(0,0,W,H);stable();}
  vnear(n.camera.positionAU,position,2e-14);
  n.dolly(.8);stable();n.dolly(1.25);stable();vnear(n.camera.positionAU,position,2e-14);
  for(let i=0;i<5;i++){n.setMode('free');n.look(0,0,W,H);stable();n.setMode('orbit');stable();n.orbit(0,0,W,H);stable();}
  n.selectTarget('earth',false);stable();n.selectTarget('earth',true);while(n.isFlying)n.update(.1);stable();
 }
});

test('moving target translation follows through inverted/pole orientations without changing the screen frame',()=>{
 const actual=computeSpace(snapshot.date),n=new Navigation(actual);n.orbit(110,600,W,H);n.orbit(45,72,W,H);
 let before=cameraBasis(n.camera),last=actual.bodies.find(b=>b.id==='earth')!,offset=n.camera.positionAU.map((x,i)=>x-last.positionAU[i]) as Vec3;
 for(let i=1;i<=20;i++){
  const next=computeSpace(new Date(snapshot.date.getTime()+i*86400000));n.setSnapshot(next);last=next.bodies.find(b=>b.id==='earth')!;
  vnear(n.camera.positionAU.map((x,j)=>x-last.positionAU[j]) as Vec3,offset,3e-15);
  for(const k of ['forward','right','up'] as const)vnear(cameraBasis(n.camera)[k],before[k],3e-10);
  const p=projectSpace(last.positionAU,n.camera,W,H);near(p.x,W/2,2e-8);near(p.y,H/2,2e-8);assert.ok(p.visible);
 }
 n.setMode('free');const fixed=n.camera.positionAU;n.setSnapshot(computeSpace(new Date('2026-11-14T00:00:00Z')));assert.deepEqual(n.camera.positionAU,fixed);
});

test('parallel-transport facing does not use a canonical up at poles and opposite-facing targets',()=>{
 for(const p of [-270,-180,-90,90,180,270]){
  const n=fixture('free');drag(n,'free',0,p);const original=cameraBasis(n.camera),target=original.forward.map(x=>-x) as Vec3;
  const turned=faceCamera(n.camera,target),b=cameraBasis(turned);vnear(b.forward,target);vnear(b.up,original.up);
  const same=faceCamera(n.camera,original.forward);assert.equal(same.altitudeDeg,n.camera.altitudeDeg);assert.equal(same.azimuthDeg,n.camera.azimuthDeg);assert.equal(same.rollDeg,n.camera.rollDeg);
 }
});

test('camera API accepts full pitch and legacy roll-less values, rejects nonfinite orientation atomically, resets deterministically',()=>{
 const n=fixture('free');
 for(const pitch of [-1080,-450,-270,-180,-90,90,180,270,450,1080]){n.setCamera({...initial,altitudeDeg:pitch});basisNear(n.camera,qdrag(0,pitch));}
 n.setCamera({...initial,altitudeDeg:180,rollDeg:30});const saved=n.camera;
 for(const property of ['azimuthDeg','altitudeDeg','rollDeg','fovDeg'] as const)for(const value of [NaN,Infinity,-Infinity]){assert.throws(()=>n.setCamera({...saved,[property]:value}),RangeError);assert.deepEqual(n.camera,saved);assert.equal(validCamera({...saved,[property]:value}),false);}
 assert.throws(()=>n.look(Number.MAX_VALUE,0,1,1),RangeError);assert.deepEqual(n.camera,saved);
 assert.throws(()=>n.orbit(0,Number.MAX_VALUE,1,1),RangeError);assert.deepEqual(n.camera,saved);
 n.setCamera({...initial,fovDeg:1});assert.equal(n.camera.fovDeg,30);n.setCamera({...initial,fovDeg:900});assert.equal(n.camera.fovDeg,90);
 n.setSpeed(1e99);assert.equal(n.view.speedAUPerSecond,1000);n.resetEarth();const fresh=new Navigation(snapshot);assert.deepEqual(n.view,fresh.view);n.frameSystem();fresh.frameSystem();assert.deepEqual(n.view,fresh.view);
});

test('full rotation keeps collision/safe radius and does not skip an obstacle in huge repeated orbit drags',()=>{
 const blocker=planet('blocker',[0,R,0],12000),world={...snapshot,bodies:[...snapshot.bodies,blocker]};
 for(const angle of [180,720,36000]){
  const n=new Navigation(world);n.setCamera(initial);n.orbit(0,angle*H/180,W,H);
  assert.ok(n.camera.positionAU[2]>0,'stops before blocker at first north crossing');near(length(n.camera.positionAU),R,1e-14);
  assert.ok(distance(n.camera.positionAU,blocker.positionAU)>blocker.radiusKm/AU_KM*COLLISION_RADIUS_RATIO);
  for(let i=0;i<20;i++)n.dolly(.01);assert.ok(length(n.camera.positionAU)>=earth.radiusKm/AU_KM*COLLISION_RADIUS_RATIO);
 }
});

// Renderer protocol test: actual uniform upload, point picking and limb/tick math,
// not a claim of browser paint or new native-GPU pixels.
test('renderer GL basis, point picking, body center and four perimeter ticks agree throughout two inverted revolutions',async t=>{
 const stars:CatalogStar3D[]=[];
 for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1])if(x||y||z)stars.push({id:`s:${x},${y},${z}`,name:'fixture',sourceId:'test',positionAU:[x*1000,y*1000,z*1000],absoluteMagnitude:0,bv:0,distancePc:1});
 const rec=recordingCanvas(W,H),old=globalThis.Image;globalThis.Image=rec.FakeImage as any;t.after(()=>{globalThis.Image=old;});
 const renderer=new SpaceRenderer(rec.canvas);await renderer.init(stars);t.after(()=>renderer.dispose());const n=fixture();let count=0;
 for(const angle of [-720,-450,-360,-270,-180,-90,-89.99,0,89.99,90,90.01,180,270,360,450,720]){
  n.setCamera(initial);n.setMode('orbit');drag(n,'orbit',0,angle);drag(n,'orbit',11,3);const q=mul(qdrag(0,angle),qdrag(11,3)),expected=qbasis(q),start=rec.draws.length;
  renderer.render(snapshot,n.view,{labels:true,orbits:false,cinematic:true,photographicBackground:false},1000+count*16);const draws=rec.draws.slice(start),points=draws.find(d=>d.uniforms.u_right);assert.ok(points);
  for(const key of ['right','up','forward'] as const)vnear(points.uniforms[`u_${key}`],expected[key]);
  const frame=bodyFrame(earth,snapshot.bodies[1].positionAU,n.camera,W,H)!;assert.ok(frame);const p=renderer.project(earth.positionAU,n.camera);near(p.x,W/2,2e-8);near(p.y,H/2,2e-8);
  const body=draws.find(d=>d.uniforms.u_earth?.[0]===1);assert.ok(body);near(body.uniforms.u_centerNdc[0],0,1e-10);near(body.uniforms.u_centerNdc[1],0,1e-10);
  for(const key of ['right','up','forward'] as const)vnear(body.uniforms[`u_body${key[0].toUpperCase()+key.slice(1)}`],expected[key]);
  const rr=H*(earth.radiusKm/AU_KM/R)/Math.sqrt(1-(earth.radiusKm/AU_KM/R)**2)/(2*Math.tan(30*D));near(frame.radiusCssPixels,rr,1e-9);
  const size=focusSizeCssPixels(earth.radiusKm,R,n.camera.fovDeg,W,H),ticks=focusTicks(p.x,p.y,size,W,H);assert.equal(ticks.length,4);assert.ok(ticks.every(t=>t.visible));
  near(ticks[0].y+ticks[0].height,p.y-rr-6);near(ticks[1].x,p.x+rr+6);near(ticks[2].y,p.y+rr+6);near(ticks[3].x+ticks[3].width,p.x-rr-6);
  assert.equal(renderer.pick(p.x,p.y,snapshot,n.view),'earth');assert.ok(bodyHitDistance(frame,p.x+rr*.999,p.y,W,H,n.camera)!>0);assert.equal(bodyHitDistance(frame,p.x+rr*1.001,p.y,W,H,n.camera),null);
  let picked=0;
  for(const s of stars){const rel=s.positionAU.map((v,i)=>v-n.camera.positionAU[i]) as Vec3,depth=dot(rel,expected.forward);if(depth<=0)continue;
   const x=W/2+H/2*dot(rel,expected.right)/(depth*Math.tan(30*D)),y=H/2-H/2*dot(rel,expected.up)/(depth*Math.tan(30*D));if(x<10||x>W-10||y<10||y>H-10||Math.hypot(x-W/2,y-H/2)<rr+30)continue;
   const projected=renderer.project(s.positionAU,n.camera);near(projected.x,x,1e-7);near(projected.y,y,1e-7);assert.equal(renderer.pick(x,y,{...snapshot,bodies:[earth]},n.view),s.id);picked++;
  }
  assert.ok(picked>0,`point pick coverage angle ${angle}`);count++;
 }
 assert.equal(count,16);
});

// User contract: dragging right moves the apparent foreground to the right.
// Orbit therefore moves the camera to screen-left around the fixed target.
// Direct pixel input (not the angular helper above) locks down this sign.
for(const sign of [-1,1])test(`horizontal orbit raw ${sign>0?'right':'left'} drag follows the finger at upright, poles and rolled views`,()=>{
 for(const [pitch,roll] of [[0,0],[90,0],[-90,0],[180,0],[270,35],[-270,-55],[34,71]]){
  const n=fixture('orbit');n.setCamera({...initial,altitudeDeg:pitch,rollDeg:roll});n.setMode('free');
  // Establish a true target-facing orbit at this screen frame without using orbit input.
  const basis=cameraBasis({...initial,altitudeDeg:pitch,rollDeg:roll});n.setCamera({...initial,altitudeDeg:pitch,rollDeg:roll,positionAU:basis.forward.map(x=>-R*x) as Vec3});n.setMode('orbit');
  const start=n.camera,b=cameraBasis(start);n.orbit(sign*W/60,0,W,H);const after=n.camera,delta=after.positionAU.map((x,i)=>x-start.positionAU[i]) as Vec3;
  assert.ok(dot(delta,b.right)*sign<0,'camera follows opposite screen-side orbit for grab-style drag');
  near(dot(cameraBasis(after).forward,b.right),sign*Math.sin(3*D),2e-10);near(length(after.positionAU),R,2e-13);assert.equal(after.fovDeg,start.fovDeg);
  const center=projectSpace(earth.positionAU,after,W,H);near(center.x,W/2,2e-8);near(center.y,H/2,2e-8);
  // A near-side physical landmark, initially centered, moves with the finger.
  const landmark=start.positionAU.map(x=>x*.04) as Vec3,p=projectSpace(landmark,after,W,H);assert.ok((p.x-W/2)*sign>0);near(p.y,H/2,2e-8);
 }
});
test('raw drag keeps free horizontal sign, vertical orbit and wheel-like dolly behavior unchanged',()=>{
 for(const sign of [-1,1]){
  const free=fixture('free');free.look(sign*H/20,0,W,H);near(dot(cameraBasis(free.camera).forward,[1,0,0]),-sign*Math.sin(3*D));assert.deepEqual(free.camera.positionAU,initial.positionAU);
  const orbit=fixture();orbit.orbit(0,sign*H/60,W,H);basisNear(orbit.camera,qdrag(0,-sign*3));const before=length(orbit.camera.positionAU),fov=orbit.camera.fovDeg;orbit.dolly(.8);near(length(orbit.camera.positionAU),before*.8);assert.equal(orbit.camera.fovDeg,fov);
 }
});
