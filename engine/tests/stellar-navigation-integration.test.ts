import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Navigation } from '../src/space/navigation';
import { computeSpace } from '../src/space/world';
import { getStellarModel } from '../src/space/stellar-model';
import { AU_KM, type CatalogStar3D, type SpaceCamera } from '../src/space/types';
import { cameraBasis, distance, add, scale, subtract, dot, normalize } from '../src/space/math';
import { focusSizeCssPixels, focusTicks } from '../src/space/focus';
const stars:CatalogStar3D[]=JSON.parse(readFileSync(new URL('../public/data/space-stars.json',import.meta.url),'utf8')).stars;
const snapshot=computeSpace(new Date('2026-10-14T14:58:00Z'));
const find=(name:string)=>{const s=stars.find(s=>s.name===name);assert.ok(s,name);return s;};
const tolerance=(s:CatalogStar3D)=>Math.max(1e-12,Math.max(...s.positionAU.map(Math.abs))*Number.EPSILON*64);
const finish=(nav:Navigation)=>{for(let i=0;i<500&&nav.isFlying;i++)nav.update(1/60);assert.equal(nav.isFlying,false,'bounded flight completes');};
function finite(nav:Navigation){assert.ok(nav.camera.positionAU.every(Number.isFinite));for(const v of Object.values(cameraBasis(nav.camera)))assert.ok(v.every(Number.isFinite));assert.equal(nav.camera.fovDeg,60);}
for(const name of ['Scheat','Sirius','Proxima Centauri','Vega'])test(`stellar go-to and dolly resolves ${name} from actual model radius, not100AU`,()=>{
 const s=find(name),model=getStellarModel(s);assert.ok(model);const r=model.radiusKm/AU_KM,nav=new Navigation(snapshot,stars),initial=nav.camera.positionAU;
 assert.equal(nav.selectTarget(s.id),true);finish(nav);finite(nav);
 assert.ok(distance(initial,nav.camera.positionAU)>100000);
 assert.ok(Math.abs(nav.getSelectedInfo()!.distanceAU/r-4.5)<tolerance(s)/r,'4.5 model radii arrival');
 assert.equal(nav.getSelectedInfo()!.radiusAU,r);assert.equal(nav.getSelectedInfo()!.illuminatedFraction,null,'self-luminous not solar-lit phase');
 assert.equal(nav.getSelectedInfo()!.kind,'star');
 const initialSize=focusSizeCssPixels(model.radiusKm,nav.getSelectedInfo()!.distanceAU,60,1200,800);assert.ok(initialSize>250);
 const before=nav.camera.positionAU;nav.dolly(.8);assert.ok(distance(before,nav.camera.positionAU)>0);finite(nav);
 assert.ok(focusSizeCssPixels(model.radiusKm,nav.getSelectedInfo()!.distanceAU,60,1200,800)>initialSize);
 const min=1.05*r;for(let i=0;i<12;i++)nav.dolly(.01);
 assert.ok(nav.getSelectedInfo()!.distanceAU>=min-tolerance(s));assert.ok(nav.getSelectedInfo()!.distanceAU<min*1.001+tolerance(s));
 const closeSpeed=nav.view.speedAUPerSecond;nav.dolly(20);assert.ok(nav.view.speedAUPerSecond>closeSpeed*5);
 const radius=nav.getSelectedInfo()!.distanceAU,start=nav.camera.positionAU;
 for(let i=0;i<144;i++){nav.orbit(0,800/72,1200,800);finite(nav);const info=nav.getSelectedInfo()!;assert.ok(Math.abs(info.distanceAU-radius)<tolerance(s)*200);assert.ok(dot(cameraBasis(nav.camera).forward,normalize(subtract(s.positionAU,nav.camera.positionAU)))>1-1e-7);}
 assert.ok(distance(start,nav.camera.positionAU)<tolerance(s)*500,'two full up/down turns');nav.dispose();
});

test('stellar selection-only preserves position and manual input cancels flight; free camera remains world-fixed',()=>{
 const s=find('Scheat'),nav=new Navigation(snapshot,stars),start=nav.camera.positionAU;nav.selectTarget(s.id,false);assert.deepEqual(nav.camera.positionAU,start);assert.equal(nav.isFlying,false);
 nav.selectTarget(s.id);nav.update(.1);nav.look(4,5,1000,700);assert.equal(nav.isFlying,false);assert.equal(nav.view.mode,'free');
 const fixed=nav.camera.positionAU;nav.setSnapshot(computeSpace(new Date('2030-01-01T00:00:00Z')));assert.deepEqual(nav.camera.positionAU,fixed);finite(nav);
});

test('stellar surface guard prevents direct placement and high-speed tunnelling through selected or unselected modeled stars',()=>{
 const s=find('Sirius'),r=getStellarModel(s)!.radiusKm/AU_KM,nav=new Navigation(snapshot,stars);
 nav.setMode('free');const facing:SpaceCamera={positionAU:add(s.positionAU,[0,0,4*r]),azimuthDeg:0,altitudeDeg:0,fovDeg:60};nav.setCamera(facing);
 nav.setSpeed(1000);nav.move([0,0,1],.25,true);assert.ok(distance(nav.camera.positionAU,s.positionAU)>=r*1.05-tolerance(s));assert.ok(nav.camera.positionAU[2]>s.positionAU[2]);
 nav.selectTarget(s.id,false);nav.setCamera({...facing,positionAU:[...s.positionAU]});assert.ok(distance(nav.camera.positionAU,s.positionAU)>=r*1.05-tolerance(s));finite(nav);
});

test('perimeter marks remain outside a resolved modeled stellar limb at portrait/landscape, including full-screen hiding',()=>{
 const s=find('Scheat'),r=getStellarModel(s)!.radiusKm;
 for(const [w,h] of [[1200,800],[390,844]])for(const ratio of [4.5,2,1.05]){
  const d=r/AU_KM*ratio,projected=h/(2*Math.tan(Math.PI/6))*Math.tan(Math.asin(1/ratio));
  const size=focusSizeCssPixels(r,d,60,w,h),ticks=focusTicks(w/2,h/2,size,w,h);
  for(const t of ticks){const near=Math.hypot(Math.max(t.x-w/2,0,w/2-t.x-t.width),Math.max(t.y-h/2,0,h/2-t.y-t.height));assert.ok(near>=projected+6-1e-7);}
  if(projected>Math.hypot(w,h))assert.ok(ticks.every(t=>!t.visible));
 }
});
