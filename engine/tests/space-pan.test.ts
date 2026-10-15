import test from 'node:test';import assert from 'node:assert/strict';
import {Navigation,COLLISION_RADIUS_RATIO} from '../src/space/navigation';
import {cameraBasis,dot,distance} from '../src/space/math';
import {projectSpace} from '../src/space/render-math';
import {AU_KM,type SpaceBody,type SpaceSnapshot,type Vec3} from '../src/space/types';
const R=.001,W=1000,H=700;
const body:SpaceBody={id:'earth',name:'test',nameEn:'test',kind:'planet',positionAU:[0,0,0],radiusKm:6378.137,color:'#fff',textureId:'earth',axisPrime:[1,0,0],axisEast:[0,0,1],axisNorth:[0,1,0]};
const snapshot:SpaceSnapshot={date:new Date('2026-10-15T00:00:00Z'),bodies:[body,{...body,id:'sun',kind:'star',positionAU:[100,0,0],radiusKm:695700}]};
function fixture(pitch=0,roll=0){const nav=new Navigation(snapshot),camera={positionAU:[0,0,R] as Vec3,azimuthDeg:0,altitudeDeg:pitch,rollDeg:roll,fovDeg:60},b=cameraBasis(camera);nav.setCamera({...camera,positionAU:b.forward.map(x=>-x*R) as Vec3});nav.setMode('orbit');return nav;}
for(const [pitch,roll]of [[0,0],[90,0],[-90,0],[180,0],[34,71],[-270,-55]])test(`left-pan geometry follows screen axes without rotating or zooming at pitch${pitch}/roll${roll}`,()=>{
 for(const [dx,dy]of [[50,0],[-50,0],[0,35],[0,-35],[25,-30]]){
  const n=fixture(pitch,roll),before=n.camera,b=cameraBasis(before),scale=2*R*Math.tan(Math.PI/6)/H;n.pan(dx,dy,W,H,R);const after=n.camera,d=after.positionAU.map((x,i)=>x-before.positionAU[i]) as Vec3;
  assert.ok(Math.abs(dot(d,b.right)+dx*scale)<1e-13);assert.ok(Math.abs(dot(d,b.up)-dy*scale)<1e-13);assert.ok(Math.abs(dot(d,b.forward))<1e-13);
  for(const k of ['azimuthDeg','altitudeDeg','rollDeg','fovDeg'] as const)assert.equal(after[k],before[k]);assert.equal(n.view.mode,'free');assert.equal(n.view.selectedId,'earth');
  const p=projectSpace([0,0,0],after,W,H);assert.ok(Math.abs(p.x-W/2-dx)<1e-7);assert.ok(Math.abs(p.y-H/2-dy)<1e-7);
 }
});
test('pan uses a fixed gesture depth, is subdivision-independent and releases follow without elapsed-time coupling',()=>{const a=fixture(34,71),b=fixture(34,71);a.pan(150,-120,W,H,R);for(let i=0;i<30;i++)b.pan(5,-4,W,H,R);assert.ok(distance(a.camera.positionAU,b.camera.positionAU)<1e-13);const fixed=a.camera;a.setSnapshot({...snapshot,bodies:snapshot.bodies.map(p=>({...p,positionAU:p.positionAU.map((v,i)=>v+(i===0?.0001:0)) as Vec3}))});assert.deepEqual(a.camera,fixed);a.update(.1);assert.deepEqual(a.camera,fixed);});
test('pan validates input before mutation, respects physical obstacles and keeps middle-orbit usable afterwards',()=>{const n=fixture(),before=n.view;for(const args of [[NaN,0,W,H,R],[0,0,0,H,R],[5,5,W,H,0],[Number.MAX_VALUE,1,W,H,R]]){assert.throws(()=>n.pan(...args as [number,number,number,number,number]),RangeError);assert.deepEqual(n.view,before);}n.pan(100,0,W,H,R);n.orbit(50,20,W,H);assert.equal(n.view.mode,'orbit');assert.equal(n.view.selectedId,'earth');assert.equal(n.camera.fovDeg,60);assert.ok(distance(n.camera.positionAU,body.positionAU)>=body.radiusKm/AU_KM*COLLISION_RADIUS_RATIO);});
