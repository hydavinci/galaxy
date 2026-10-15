import test from 'node:test';
import assert from 'node:assert/strict';
import {allSkySettings,bodyInspectionFov,planetLocatorMagnitude} from '../src/observer/allsky';
import {computeSky,DEFAULT_LOCATION} from '../src/observer/astronomy';
import {skyPhotometry,projectDirection} from '../src/observer/sky-renderer';
import type {SkySettings} from '../src/observer/types';
const legacy:SkySettings={ground:true,atmosphere:true,refraction:true,grid:false,constellations:false,labels:true,milkyWay:true,mode:'visual',lightPollution:9};
test('all-sky policy cannot inherit terrestrial masking from saved ground-observer settings',()=>{const all=allSkySettings(legacy);assert.equal(all.ground,false);assert.equal(all.atmosphere,false);assert.equal(all.refraction,false);assert.equal(all.labels,true);assert.equal(legacy.ground,true);});
test('every solar-system target projects to the view center regardless of its signed altitude or time',()=>{
 for(const iso of ['2026-10-13T04:00:00Z','2026-10-13T12:50:08Z']){
  const state=computeSky(new Date(iso),DEFAULT_LOCATION);
  for(const body of state.bodies){const c={azimuthDeg:body.azimuthDeg,altitudeDeg:body.altitudeDeg,fovDeg:bodyInspectionFov(body.angularDiameterRad)};const p=projectDirection(body.direction,c,1200,800,false);assert.equal(p.visible,true,body.id);assert.ok(Math.abs(p.x-600)<.02);assert.ok(Math.abs(p.y-400)<.02);assert.ok(c.fovDeg>=.0001&&c.fovDeg<=110);}
 }
});
test('daylight does not dim all-sky view and locator brightness does not alter physical magnitudes',()=>{
 const all=allSkySettings(legacy);assert.deepEqual(skyPhotometry(50,all,70),skyPhotometry(-50,all,70));
 const state=computeSky(new Date('2026-10-13T12:50:08Z'),DEFAULT_LOCATION);const neptune=state.bodies.find(b=>b.id==='neptune')!;const before=neptune.magnitude;
 assert.ok(before>5);assert.equal(planetLocatorMagnitude(before),2);assert.equal(neptune.magnitude,before);assert.equal(planetLocatorMagnitude(-4),-4);
});
