import test from 'node:test';
import assert from 'node:assert/strict';
import * as AstronomyModule from 'astronomy-engine';
const Astronomy:typeof AstronomyModule=Reflect.get(AstronomyModule,'default')??AstronomyModule;
import {computeSky,DEFAULT_LOCATION} from '../src/observer/astronomy';
import {bodyDiskContains,bodyViewGeometry,cameraBasis,transformDirection} from '../src/observer/sky-renderer';
import {inspectionRingFov,intersectSaturnRing,planetShadowsRing,SATURN_RING_INNER,SATURN_RING_OUTER} from '../src/observer/saturn-rings';
import {BODY_FRAG} from '../src/observer/shaders/sky';
import type {Vec3} from '../src/observer/types';
const dot=(a:Vec3,b:Vec3)=>a.reduce((s,x,i)=>s+x*b[i],0);
const norm=(a:Vec3):Vec3=>a.map(x=>x/Math.hypot(...a)) as Vec3;
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const near=(a:number,b:number,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const pointRay=(p:Vec3,r:number):Vec3=>[p[0]*r,p[1]*r,1+p[2]*r];

test('main-ring bounds use NASA PDS C inner/A outer and navigation fits 70% without changing globe size',()=>{
 near(SATURN_RING_INNER,74491/60268);near(SATURN_RING_OUTER,136770/60268);
 for(const [w,h]of [[1440,900],[390,844],[844,390]])for(const d of [1e-5,8e-5,.001]){
  const f=inspectionRingFov(d,w,h),g=bodyViewGeometry([0,0,-1],Math.sin(d/2),{azimuthDeg:0,altitudeDeg:0,fovDeg:f},w,h,SATURN_RING_OUTER)!;
  near((g.rect[2]-g.rect[0])*w/2,.7*Math.min(w,h),1e-7);
  near((g.rect[3]-g.rect[1])*h/2,.7*Math.min(w,h),1e-7);
  assert.ok(g.radiusCssPixels*2<.31*Math.min(w,h));
 }
});

test('face-on ring is a physical annulus, never a solid disk; radial UV inner to outer is not reversed',()=>{
 for(const r of [1e-7,4e-5,.004]){
  for(const x of [0,.5,1,1.23,2.28,3])assert.equal(intersectSaturnRing(pointRay([x,0,0],r),r,[0,0,1]),null);
  for(const x of [1.25,1.7,2.25]){
   const hit=intersectSaturnRing(pointRay([x,0,0],r),r,[0,0,1])!;assert.ok(hit);near(hit.radial,x,1e-10);
   near(hit.radialUv,(x-SATURN_RING_INNER)/(SATURN_RING_OUTER-SATURN_RING_INNER));assert.equal(hit.sphereHit,false);
  }
 }
});

test('inclined annulus correctly identifies front and back crossings through the circular globe',()=>{
 const north:Vec3=[0,Math.sqrt(.96),.2],r=4e-5;
 let front=0,back=0,outside=0;
 for(let y=-2.3;y<=2.3;y+=.025)for(let x=-2.3;x<=2.3;x+=.025){
  const hit=intersectSaturnRing([x*r,y*r,1],r,north);if(!hit)continue;
  near(dot(hit.point,north),0,1e-10);
  if(hit.sphereHit){if(hit.inFrontOfSphere)front++;else back++;}else outside++;
 }
 assert.ok(front>100&&back>100&&outside>1000,`${front}/${back}/${outside}`);
 // An ideal zero-thickness ring plane projects to zero area exactly edge-on.
 for(const x of [-2,-1,0,1,2])assert.equal(intersectSaturnRing([x*r,0,1],r,[0,1,0]),null);
});

test('real IAU Saturn pole gives open rings in 2017 and an edge-on interval in 2025, not fixed artwork',()=>{
 const openings:number[]=[];
 for(const iso of ['2017-06-15T00:00:00Z','2025-03-23T00:00:00Z','2026-10-14T00:00:00Z','2032-06-15T00:00:00Z']){
  const state=computeSky(new Date(iso),DEFAULT_LOCATION),body=state.bodies.find(b=>b.id==='saturn')!;
  const a=Astronomy.RotationAxis(Astronomy.Body.Saturn,state.date),north=norm(transformDirection(state.equatorialToHorizontal,[a.north.x,a.north.z,a.north.y]));
  const camera={azimuthDeg:body.azimuthDeg,altitudeDeg:body.altitudeDeg,fovDeg:inspectionRingFov(body.angularDiameterRad)},g=bodyViewGeometry(body.direction,Math.sin(body.angularDiameterRad/2),camera,1200,800,SATURN_RING_OUTER)!;
  assert.ok(g);const local:Vec3=[dot(north,g.right),dot(north,g.up),dot(north,g.forward)];
  const opening=Math.abs(dot(north,body.direction));openings.push(opening);near(Math.abs(local[2]),opening,1e-7);
  const a1=norm(cross(local,Math.abs(local[2])<.9?[0,0,1]:[0,1,0])),a2=norm(cross(local,a1)),r=Math.sin(body.angularDiameterRad/2);
  let hits=0;
  for(let i=0;i<72;i++){
   const p=a1.map((v,j)=>1.8*(v*Math.cos(i*Math.PI/36)+a2[j]*Math.sin(i*Math.PI/36))) as Vec3;
   const hit=intersectSaturnRing(pointRay(p,r),r,local);assert.ok(hit,`${iso}/${i}`);near(hit.radial,1.8,1e-7);hits++;
  }
  assert.equal(hits,72);
 }
 assert.ok(openings[0]>.4);assert.ok(openings[1]<.01);assert.ok(openings[2]>.05);assert.ok(openings[3]>.4);
});

test('ring-only visible pixels retain a draw rect at every edge, off-axis and minimum FOV; circle picking unchanged',()=>{
 for(const fovDeg of [.0001,.01,70,110])for(const [w,h]of [[1440,900],[390,844]]){
  const camera={azimuthDeg:123,altitudeDeg:31,fovDeg},b=cameraBasis(camera),ty=Math.tan(fovDeg*Math.PI/360),radius=80*ty/h;
  for(const side of [-1,1]){
   const nx=side*(1+65*2/w),p=norm(b.forward.map((v,i)=>v+b.right[i]*nx*ty*w/h) as Vec3);
   assert.equal(bodyViewGeometry(p,radius,camera,w,h),null,'globe wholly outside');
   const g=bodyViewGeometry(p,radius,camera,w,h,SATURN_RING_OUTER);assert.ok(g,'outer rings still intersect screen');
   near(g.radiusCssPixels,h*radius/Math.sqrt(1-radius*radius)/(2*ty));
   assert.equal(bodyDiskContains(p,2*Math.asin(radius),camera,w,h,side<0?0:w,h/2),false,'ring is not silently selectable as a bloated globe');
   assert.ok(g.rect.every(x=>Number.isFinite(x)&&x>=-1&&x<=1));
  }
 }
});

test('parallel-light planet umbra is on the antisolar part of rings, not a painted fixed stripe',()=>{
 assert.equal(planetShadowsRing([-1.8,0,0],[1,0,0]),true);
 assert.equal(planetShadowsRing([1.8,0,0],[1,0,0]),false);
 assert.equal(planetShadowsRing([-1.8,1.01,0],[1,0,0]),false);
 assert.equal(planetShadowsRing([-1.8,0,0],[-1,0,0]),false);
 assert.equal(planetShadowsRing([0,-1.8,0],[0,1,0]),true);
 assert.match(BODY_FRAG,/along < -sqrt\(max\(0\.0,discriminant\)\)/);
 assert.match(BODY_FRAG,/if\(opacity<=0\.001\)discard/);
 assert.match(BODY_FRAG,/body=mix\(body,ringColor,profile\.a\)/);
 assert.match(BODY_FRAG,/planetShadow\?0\.0/);
 assert.match(BODY_FRAG,/vec2\(radialUv,0\.5\)/);
});
