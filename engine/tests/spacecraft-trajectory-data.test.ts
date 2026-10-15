import type {SpacecraftTarget} from '../src/space/spacecraft-target';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {validateTrajectoryData,sampleTrajectory,trajectoryPositionAt,trajectoryDefaultTime,trajectoryPath} from '../src/space/trajectories';
import {computeSpace} from '../src/space/world';import {Navigation,COLLISION_RADIUS_RATIO} from '../src/space/navigation';
import {AU_KM,type SpacecraftTarget} from '../src/space/types';import {cameraBasis,distance,dot,normalize,subtract} from '../src/space/math';
const path=new URL('../public/data/spacecraft-trajectories.json',import.meta.url),bytes=readFileSync(path),data=validateTrajectoryData(JSON.parse(bytes.toString())),now=Date.UTC(2026,9,15,3);
test('all twelve sourced records and prediction/history labels match the independently acquired immutable dataset',()=>{
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'47a630f45fd60cd77f0013acae39d842cc207cfc29555fd7f9ae3ab4f22aa8c2');assert.equal(bytes.length,931476);assert.equal(data.records.length,12);
 assert.equal(data.records.filter(r=>r.kind==='ephemeris').length,9);assert.equal(data.records.filter(r=>r.kind==='surface-site').length,3);const ephemeris=data.records.filter(r=>r.kind==='ephemeris');assert.equal(ephemeris.reduce((n,r)=>n+r.sampleCount,0),6109);assert.equal(ephemeris.reduce((n,r)=>n+r.validationSamples,0),18300);assert.equal(ephemeris.filter(r=>r.quality==='predicted').length,7);assert.equal(ephemeris.filter(r=>trajectoryPositionAt(r,now)).length,8);
 for(const r of ephemeris){assert.ok(r.maxInterpolationErrorKm<2);assert.ok(r.notes.includes('不是'));assert.ok(r.solution);assert.ok(r.sourceQueries.length);}
});
for(const record of data.records)test(`real ${record.missionId} default position is navigable with correct center/coverage and no physical spacecraft radius`,()=>{
 const epoch=trajectoryDefaultTime(record)!;assert.ok(Number.isSafeInteger(epoch));const snapshot=computeSpace(new Date(epoch)),state=sampleTrajectory(record,epoch,snapshot)!;assert.ok(state,record.missionId);const center=snapshot.bodies.find(b=>b.id===state.centerBodyId)!;assert.ok(distance(subtract(state.positionAU,center.positionAU),state.relativePositionAU)<1e-12);
 const craft:SpacecraftTarget={id:`craft:${state.missionId}`,missionId:state.missionId,name:state.name,nameEn:state.name,kind:'spacecraft',positionAU:state.positionAU,viewDistanceAU:state.viewDistanceAU,centerBodyId:state.centerBodyId},n=new Navigation(snapshot);n.setSpacecraft([craft]);assert.ok(n.selectTarget(craft.id));for(let i=0;i<50&&n.isFlying;i++)n.update(.1);assert.equal(n.isFlying,false);assert.equal(n.getSelectedInfo()!.radiusAU,null);assert.equal(n.getSelectedInfo()!.kind,'spacecraft');assert.equal(n.camera.fovDeg,60);assert.ok(dot(cameraBasis(n.camera).forward,normalize(subtract(state.positionAU,n.camera.positionAU)))>1-1e-8);
 for(const body of snapshot.bodies)assert.ok(distance(n.camera.positionAU,body.positionAU)>=body.radiusKm/AU_KM*COLLISION_RADIUS_RATIO*(1-1e-8),`${record.missionId}/${body.id} collision`);
 if(record.kind==='ephemeris'){assert.equal(trajectoryPositionAt(record,record.startMs-1),null);assert.equal(trajectoryPositionAt(record,record.endMs+1),null);assert.equal(trajectoryPath(record,snapshot).length,record.sampleCount);for(const t of [record.startMs,record.endMs])assert.ok(sampleTrajectory(record,t,computeSpace(new Date(t))));}
 else if(record.kind==='surface-site'){assert.equal(sampleTrajectory(record,record.siteEpochMs-1,computeSpace(new Date(record.siteEpochMs-1))),null);assert.equal(trajectoryPath(record,snapshot).length,0);assert.equal(state.velocityAUPerSecond,null);assert.ok(Math.abs(distance(state.positionAU,center.positionAU)-center.radiusKm/AU_KM)<1e-13);assert.match(record.notes,/不是|不表示/);}
 n.dispose();
});
test('site date anchors and TLE scope are explicit instead of falsely called current locations or landing instants',()=>{
 const site=data.records.find(r=>r.missionId==='change-6')!;assert.equal(site.kind,'surface-site');if(site.kind==='surface-site'){assert.equal(new Date(site.siteEpochMs).toISOString(),'2024-06-07T00:00:00.000Z');assert.match(site.notes,/观测日期/);assert.match(site.notes,/不声称.*着陆时刻/);}
 const hst=data.records.find(r=>r.missionId==='hubble')!;assert.equal(hst.kind,'ephemeris');if(hst.kind==='ephemeris'){assert.equal(hst.quality,'tle-derived');assert.equal(hst.endMs-hst.startMs,86400000);}
 const app=readFileSync(new URL('../src/space/app.ts',import.meta.url),'utf8');assert.doesNotMatch(app,/暂停到着陆时刻/);assert.match(app,/资料日期锚点/);
});
