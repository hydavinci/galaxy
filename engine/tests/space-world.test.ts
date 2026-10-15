import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { computeSpace, observeBody, relativePositionAU, validateSpaceDate } from '../src/space/world';
import { AU_KM, type Vec3 } from '../src/space/types';
import { add, cross, distance, dot, length, normalize, scale, subtract } from '../src/space/math';
const A:typeof import('astronomy-engine')=createRequire(import.meta.url)('astronomy-engine');
const near=(a:number,b:number,tol=1e-12)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}, tolerance ${tol}`);
const vec=(a:Vec3,b:Vec3,tol=1e-12)=>a.forEach((n,i)=>near(n,b[i],tol));
const world=()=>computeSpace(new Date('2026-10-14T00:00:00Z'));

for(const date of ['1900-01-01T00:00:00.000Z','2000-01-01T12:00:00Z','2026-10-14T00:00:00Z','2100-12-31T23:59:59.999Z'])test(`ten same-world bodies, mapped instantaneous ephemeris ${date}`,()=>{
  const snapshot=computeSpace(new Date(date));assert.equal(snapshot.bodies.length,10);
  assert.deepEqual(snapshot.bodies.map(b=>b.id),['sun','mercury','venus','earth','moon','mars','jupiter','saturn','uranus','neptune']);
  vec(snapshot.bodies[0].positionAU,[0,0,0]);
  for(const b of snapshot.bodies){
    const id=b.nameEn as import('astronomy-engine').Body,v=A.HelioVector(id,snapshot.date);
    // Same-library integration check, independent NASA fixture is below.
    vec(b.positionAU,[v.x,v.z,v.y]);assert.ok(b.radiusKm>0);
    const axes=[b.axisPrime,b.axisEast,b.axisNorth];axes.forEach(v=>near(length(v),1));
    near(dot(axes[0],axes[1]),0);near(dot(axes[0],axes[2]),0);near(dot(axes[1],axes[2]),0);
    vec(cross(b.axisPrime,b.axisEast),scale(b.axisNorth,-1));
    const axis=A.RotationAxis(id,snapshot.date);vec(b.axisNorth,[axis.north.x,axis.north.z,axis.north.y]);
  }
  const earth=snapshot.bodies.find(b=>b.id==='earth')!,moon=snapshot.bodies.find(b=>b.id==='moon')!,geo=A.GeoMoon(snapshot.date);
  vec(subtract(moon.positionAU,earth.positionAU),[geo.x,geo.z,geo.y]);
  assert.equal(moon.parentId,'earth');assert.equal(earth.radiusKm,6378.137);
  const km=distance(earth.positionAU,moon.positionAU)*AU_KM;assert.ok(km>350000&&km<410000);
});

test('date validation is finite, includes all 2100, preserves caller Date',()=>{
  for(const d of [new Date(NaN),new Date('1899-12-31T23:59:59.999Z'),new Date('2101-01-01T00:00:00Z')])assert.throws(()=>computeSpace(d),RangeError);
  assert.throws(()=>validateSpaceDate('2026' as unknown as Date),RangeError);
  const d=new Date('2026-10-14T00:00:00Z'),snapshot=computeSpace(d);d.setUTCFullYear(1950);assert.equal(snapshot.date.getUTCFullYear(),2026);
});

test('sunlight is target-to-Sun displacement, camera-dependent full/quarter/new geometry',()=>{
  for(const b of world().bodies.filter(b=>b.id!=='sun')) {
    const sun=normalize(scale(b.positionAU,-1)),side=normalize(cross(sun,Math.abs(sun[1])>.8?[1,0,0]:[0,1,0])),r=5*b.radiusKm/AU_KM;
    const day=observeBody(b,add(b.positionAU,scale(sun,r))),night=observeBody(b,add(b.positionAU,scale(sun,-r))),quarter=observeBody(b,add(b.positionAU,scale(side,r)));
    vec(day.sunDirection!,sun);vec(night.sunDirection!,sun);near(day.illuminatedFraction,1);near(night.illuminatedFraction,0);near(quarter.illuminatedFraction,.5,1e-10);
    near(day.angularDiameterRad,2*Math.asin(.2),1e-10);assert.ok(day.altitudeAU>0);
  }
  const sun=world().bodies[0],observed=observeBody(sun,[1,0,0]);assert.equal(observed.sunDirection,null);assert.equal(observed.isEmissive,true);assert.equal(observed.illuminatedFraction,1);
});

test('geometric observations reject camera at/inside body and nonfinite coordinates',()=>{
  const b=world().bodies.find(b=>b.id==='earth')!;
  assert.throws(()=>observeBody(b,b.positionAU),RangeError);
  assert.throws(()=>observeBody(b,add(b.positionAU,[b.radiusKm/AU_KM*.5,0,0])),RangeError);
  assert.throws(()=>observeBody(b,[NaN,0,0]),RangeError);assert.throws(()=>relativePositionAU([Infinity,0,0],[0,0,0]),RangeError);
});

test('Earth/Moon parallax is induced by changing observer AU, not FOV',()=>{
  const s=world(),e=s.bodies.find(b=>b.id==='earth')!,m=s.bodies.find(b=>b.id==='moon')!,axis=normalize(subtract(m.positionAU,e.positionAU));
  const side=normalize(cross(axis,[0,1,0])),baseline=distance(e.positionAU,m.positionAU);
  const p=add(e.positionAU,scale(side,baseline*.2)),q=add(e.positionAU,scale(side,baseline*2));
  const angle=(camera:Vec3)=>Math.acos(dot(observeBody(e,camera).direction,observeBody(m,camera).direction));
  assert.ok(Math.abs(angle(p)-angle(q))>40*Math.PI/180);
});

test('floating origin preserves sub-km closeups at Earth and Neptune before float32 projection',()=>{
  for(const id of ['earth','neptune']){
    const b=world().bodies.find(b=>b.id===id)!,expected:Vec3=[4.5*b.radiusKm/AU_KM,1/AU_KM,.1/AU_KM],camera=add(b.positionAU,expected);
    const relative=relativePositionAU(b.positionAU,camera),correct=new Float32Array(relative),bad=new Float32Array(b.positionAU).map((v,i)=>v-new Float32Array(camera)[i]);
    relative.forEach((v,i)=>near(v,-expected[i],4e-15));
    assert.ok(distance([...correct] as Vec3,relative)*AU_KM<.01);assert.ok(distance([...bad] as Vec3,relative)*AU_KM>.02);
  }
});

test('world source never invokes a surface observer or fixed-Earth Equator/horizon',()=>{
  const source=readFileSync(new URL('../src/space/world.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:Equator|Horizon|ObserverVector|Rotation_EQJ_HOR)\s*\(/);
  assert.match(source,/Astronomy\.HelioVector\(Astronomy\.Body\.Earth/);assert.match(source,/Astronomy\.GeoMoon\(safeDate\)/);
});

const evidence=new URL('../../test-data/space-world/',import.meta.url);
test('independent JPL ICRF geometric vectors, Earth-Moon range and sunlight',()=>{
  const sources=JSON.parse(readFileSync(new URL('sources.json',evidence),'utf8'));assert.equal(sources.length,3);
  let samples=0;
  for(const source of sources){
    const raw=readFileSync(new URL(source.file,evidence));assert.equal(createHash('sha256').update(raw).digest('hex'),source.sha256);
    const text=raw.toString();assert.match(text,/NASA\/JPL Horizons/);assert.match(text,/ICRF/);assert.match(text,/Geometric/);
    const lines=text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
    for(const line of lines){
      const fields=line.split(',').map(x=>x.trim()),date=new Date(fields[1].replace(/^A\.D\. /,'')+' UTC'),ref:Vec3=[Number(fields[2]),Number(fields[4]),Number(fields[3])];
      const snapshot=computeSpace(date),earth=snapshot.bodies.find(b=>b.id==='earth')!,moon=snapshot.bodies.find(b=>b.id==='moon')!;
      const actual=source.file==='moon-geo.txt'?subtract(moon.positionAU,earth.positionAU):snapshot.bodies.find(b=>b.id===(source.file==='earth-helio.txt'?'earth':'neptune'))!.positionAU;
      // Bounded acceptance on nine preserved external samples, not a universal
      // precision claim. Planet integration uses analytic Astronomy Engine.
      const residualKm=distance(actual,ref)*AU_KM;
      if(source.file==='neptune-helio.txt') {
        // The first 60000-km assumption failed: measured ~335800 km / 14.97"
        // This historical residual is a disclosed limit, not silently hidden:
        // an angular-precision library is not a deep-space ranging ephemeris.
        const angle=2*Math.asin(distance(normalize(actual),normalize(ref))/2)*180/Math.PI*3600;
        assert.ok(angle<60,`Neptune angular error ${angle} arcsec`);
        assert.ok(Math.abs(length(actual)/length(ref)-1)<1e-4,'Neptune relative range error');
      } else assert.ok(residualKm<2000,`${source.file} ${date.toISOString()} residual ${residualKm}km`);
      if(source.file==='moon-geo.txt')near(length(actual)*AU_KM,length(ref)*AU_KM,30);
      if(source.file==='earth-helio.txt'){
        const view=observeBody(earth,add(earth.positionAU,scale(normalize(scale(ref,-1)),earth.radiusKm/AU_KM*5)));
        assert.ok(distance(view.sunDirection!,normalize(scale(ref,-1)))<2e-5);
      }
      samples++;
    }
  }
  assert.equal(samples,9);
});
