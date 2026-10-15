import test from 'node:test';
import assert from 'node:assert/strict';
import { AU_KM, type SpaceBody, type SpaceSnapshot, type Vec3 } from '../src/space/types';
import { add, dot, length, subtract } from '../src/space/math';
import { computeSpace } from '../src/space/world';
import { MAX_TRAJECTORY_SAMPLES, TRAJECTORY_FRAME_NOTICE, TRAJECTORY_MISSION_IDS, validateTrajectoryData, trajectoryPositionAt, sampleTrajectory, trajectoryPath, trajectoryDefaultTime, type EphemerisTrajectoryRecord, type SurfaceSiteTrajectoryRecord, type TrajectoryDataset, type TrajectoryRecord, type TrajectorySample } from '../src/space/trajectories';

// Deliberately fabricated analytic test vectors. NOT mission source/precision evidence.
const T=Date.UTC(2026,9,15),K=1e-5;
const position=(s:number):Vec3=>[K*(1+2*s+3*s*s+4*s*s*s),K*(-4+s*s),K*(.5-3*s+2*s*s*s)];
const velocity=(s:number):Vec3=>[K*(2+6*s+12*s*s),K*2*s,K*(-3+6*s*s)];
const sample=(s:number):TrajectorySample=>[T+s*1000,...position(s),...velocity(s)];
const fixture=():EphemerisTrajectoryRecord=>({missionId:'juno',kind:'ephemeris',label:'朱诺：纯测试多项式',centerBodyId:'jupiter',sourceUrl:'https://example.org/fixture',sourceTarget:'-61',sourceName:'TEST FIXTURE',solution:'Fabricated cubic; not mission data',quality:'predicted',startMs:T,endMs:T+7000,defaultMs:T+2000,sampleCount:3,samples:[sample(0),sample(2),sample(7)],interpolation:'cubic-hermite',maxGapSeconds:5,maxInterpolationErrorKm:0,validationSamples:2,displayRadiusAU:.001,notes:'Fixture only; not telemetry',sourceQueries:[{url:'https://example.org/test?frame=ICRF',sha256:'a'.repeat(64)}]});
const site=():SurfaceSiteTrajectoryRecord=>({missionId:'perseverance',kind:'surface-site',label:'历史着陆点测试',centerBodyId:'mars',latitudeDeg:0,longitudeDeg:0,altitudeKm:0,siteEpochMs:T,sourceUrl:'https://example.org/site',sourceName:'TEST',quality:'historical-site',notes:'Historical spherical landing location, not current rover'});
const unavailable:TrajectoryRecord={missionId:'webb',kind:'unavailable',label:'Unavailable fixture',sourceUrl:'https://example.org/unavailable',notes:'No verified fixture vectors'};
const data=(records:readonly TrajectoryRecord[]=[fixture(),site(),unavailable]):TrajectoryDataset=>({schemaVersion:1,generatedAt:'2026-10-15T00:00:00.000Z',frame:'ICRF_EQJ_Y_UP',units:'AU_AND_SECONDS',notice:'Fixtures only; not mission data or telemetry',records});
const clone=<T>(x:T):any=>JSON.parse(JSON.stringify(x));
const near=(a:number,b:number,tol=1e-12)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);
const vector=(a:Vec3,b:Vec3,tol=1e-12)=>a.forEach((v,i)=>near(v,b[i],tol));
function body(id='jupiter',positionAU:Vec3=[5,2,3]):SpaceBody{return {id,name:id,nameEn:id,kind:'planet',positionAU,radiusKm:6000,color:'#fff',textureId:id,axisPrime:[1,0,0],axisNorth:[0,1,0],axisEast:[0,0,1]};}
const snapshot=(epoch=T,center=body()):SpaceSnapshot=>({date:new Date(epoch),bodies:[center]});

test('strict fixture dataset union accepted; aliases preserve declared frame and speed units',()=>{
 const d=validateTrajectoryData(data());assert.equal(d.records.length,3);assert.equal(d.frame,'ICRF_EQJ_Y_UP');assert.equal(d.units,'AU_AND_SECONDS');assert.equal(d.records[0].kind,'ephemeris');assert.equal(d.records[1].kind,'surface-site');assert.equal(d.records[2].kind,'unavailable');assert.equal(MAX_TRAJECTORY_SAMPLES,10000);assert.match(TRAJECTORY_FRAME_NOTICE,/非所有历史日心位置/);
});
for(const [label,mutate] of Object.entries<(d:any)=>void>({
 version:d=>d.schemaVersion=2,frame:d=>d.frame='ECLIPTIC',units:d=>d.units='AU-D',extra:d=>d.surprise=true,missing:d=>delete d.notice,
 utcOffset:d=>d.generatedAt='2026-10-15T00:00:00+00:00',invalidDate:d=>d.generatedAt='2026-02-30T00:00:00Z',emptyRecords:d=>d.records=[],manyRecords:d=>d.records=Array(13).fill(d.records[0]),duplicate:d=>d.records[1]=d.records[0],unknownMission:d=>d.records[0].missionId='fictional',kind:d=>d.records[0].kind='conic',extraRecord:d=>d.records[0].elements={},center:d=>d.records[0].centerBodyId='pluto',quality:d=>d.records[0].quality='telemetry',method:d=>d.records[0].interpolation='kepler',target:d=>d.records[0].sourceTarget='Juno script',defaultOutside:d=>d.records[0].defaultMs=T-1,startMismatch:d=>d.records[0].startMs=T-1,endMismatch:d=>d.records[0].endMs=T+7001,wrongCount:d=>d.records[0].sampleCount=4,singleKnot:d=>{d.records[0].samples=[sample(0)];d.records[0].sampleCount=1;},tooManyKnots:d=>{d.records[0].samples=Array(10001).fill(sample(0));d.records[0].sampleCount=10001;},tupleLength:d=>d.records[0].samples[0].push(0),sameEpoch:d=>d.records[0].samples[1][0]=T,descending:d=>d.records[0].samples.reverse(),gap:d=>d.records[0].maxGapSeconds=4,hugeGap:d=>d.records[0].maxGapSeconds=1e99,zeroGap:d=>d.records[0].maxGapSeconds=0,fractionalEpoch:d=>d.records[0].samples[0][0]+=.1,timeDomain:d=>d.records[0].samples[0][0]=Date.UTC(1800,0,1),nanPosition:d=>d.records[0].samples[0][1]=NaN,infiniteVelocity:d=>d.records[0].samples[0][4]=Infinity,hugePosition:d=>d.records[0].samples[0][1]=1e13,hugeVelocity:d=>d.records[0].samples[0][4]=2,invalidView:d=>d.records[0].displayRadiusAU=0,negativeError:d=>d.records[0].maxInterpolationErrorKm=-1,noHoldouts:d=>d.records[0].validationSamples=0,noQueries:d=>d.records[0].sourceQueries=[],badHash:d=>d.records[0].sourceQueries[0].sha256='not-a-digest',unsafeQuery:d=>d.records[0].sourceQueries[0].url='javascript:alert(1)',queryExtra:d=>d.records[0].sourceQueries[0].html='<script>',latitude:d=>d.records[1].latitudeDeg=91,longitude:d=>d.records[1].longitudeDeg=361,altitude:d=>d.records[1].altitudeKm=-100,siteCenter:d=>d.records[1].centerBodyId='earth',siteMission:d=>d.records[1].missionId='hubble',siteQuality:d=>d.records[1].quality='current-rover',siteEpoch:d=>d.records[1].siteEpochMs=Infinity,unsafeText:d=>d.records[0].label='bad\u0000text',hugeText:d=>d.notice='x'.repeat(8193)
}))test(`schema rejects ${label}`,()=>{const d=clone(data());mutate(d);assert.throws(()=>validateTrajectoryData(d),RangeError);});
for(const url of ['javascript:alert(1)','http://example.org','https://name:secret@example.org/','data:text/html,test','https://example.org/<script>','https://example.org/ white','garbage'])test(`schema rejects unsafe source URL ${url.split(':')[0]}`,()=>{const d=clone(data());d.records[0].sourceUrl=url;assert.throws(()=>validateTrajectoryData(d),RangeError);});
test('non-plain objects and prototype tricks are rejected',()=>{assert.throws(()=>validateTrajectoryData(new Date()),RangeError);const d=clone(data());d.records[0]=Object.assign(Object.create({kind:'ephemeris'}),d.records[0]);assert.throws(()=>validateTrajectoryData(d),RangeError);});
test('canonical UTC without milliseconds accepted; geographic east 0..360 and signed longitudes equivalent',()=>{
 const d=clone(data());d.generatedAt='2026-10-15T00:00:00Z';d.records[1].longitudeDeg=206;validateTrajectoryData(d);
 vector(sampleTrajectory(d.records[1],T,snapshot(T,body('mars')) )!.relativePositionAU,sampleTrajectory({...d.records[1],longitudeDeg:-154},T,snapshot(T,body('mars')))!.relativePositionAU);
});
test('accepted data are detached and recursively frozen against source mutation',()=>{
 const raw=clone(data()),d=validateTrajectoryData(raw),r=d.records[0] as EphemerisTrajectoryRecord,before=trajectoryPositionAt(r,T+4000);
 raw.records[0].samples[1][1]=1e8;raw.records[0].sourceQueries[0].url='javascript:bad()';raw.records.length=0;
 assert.deepEqual(trajectoryPositionAt(r,T+4000),before);assert.equal(d.records.length,3);
 for(const object of [d,d.records,r,r.samples,r.samples[0],r.sourceQueries,r.sourceQueries[0]])assert.ok(Object.isFrozen(object));
 assert.throws(()=>{(r.samples[0] as any)[1]=123;},TypeError);
 const result=trajectoryPositionAt(r,T)!;result.positionAU[0]=999;assert.equal(trajectoryPositionAt(r,T)!.positionAU[0],position(0)[0]);
});
test('total serialized asset bound rejects 12 individually bounded large fixtures',()=>{
 const samples:TrajectorySample[]=Array.from({length:10000},(_,i)=>[T+i*1000,Math.PI+i/999,Math.E+i/777,Math.SQRT2+i/555,.000123456789012345,.000234567890123456,.000345678901234567]);
 const records=TRAJECTORY_MISSION_IDS.map(missionId=>({...fixture(),missionId,startMs:T,endMs:T+9999000,defaultMs:T,sampleCount:samples.length,samples,maxGapSeconds:1}));
 assert.throws(()=>validateTrajectoryData(data(records)),/6 MB/);
});
test('every knot including both exact endpoints returns original doubles and derivative',()=>{const r=fixture();for(const s of r.samples){const value=trajectoryPositionAt(r,s[0])!;assert.deepEqual(value.positionAU,s.slice(1,4));assert.deepEqual(value.velocityAUPerSecond,s.slice(4));}});
test('Hermite positions and velocity independently match cubic polynomial in seconds at 31 non-knots',()=>{
 const r=validateTrajectoryData(data()).records[0];
 for(let i=1;i<=31;i++){const seconds=i*.219;const actual=trajectoryPositionAt(r,T+seconds*1000)!;vector(actual.positionAU,position(seconds),2e-16);vector(actual.velocityAUPerSecond,velocity(seconds),2e-16);}
});
test('millisecond query, second derivative and engine Y/Z ordering are not silently rescaled/swapped',()=>{
 const r=fixture(),actual=trajectoryPositionAt(r,T+1000)!;vector(actual.positionAU,position(1));vector(actual.velocityAUPerSecond,velocity(1));assert.notEqual(actual.positionAU[1],position(1)[2]);
});
test('coverage/gap rejection never clamps or extrapolates; exact recorded knots remain available',()=>{
 const r=fixture();for(const t of [T-1,T+7001,NaN,Infinity,-Infinity])assert.equal(trajectoryPositionAt(r,t),null);
 const gap={...r,maxGapSeconds:1};assert.equal(trajectoryPositionAt(gap,T+500),null);assert.deepEqual(trajectoryPositionAt(gap,T),trajectoryPositionAt(r,T));
 assert.equal(trajectoryPositionAt({...r,samples:[]},T),null);assert.equal(trajectoryPositionAt({...r,samples:Array(10001).fill(sample(0))},T),null);
 assert.equal(trajectoryPositionAt(site(),T),null);assert.equal(trajectoryPositionAt(unavailable,T),null);
});
test('nonfinite interpolation and malformed vectors fail closed',()=>{
 const r=clone(fixture());r.samples[0][1]=NaN;assert.equal(trajectoryPositionAt(r,T),null);assert.equal(trajectoryPositionAt(r,T+1000),null);
});
test('world sample adds the CURRENT engine center but leaves relative velocity unchanged',()=>{
 const r=fixture(),s=snapshot(T+1000),before=clone(s),state=sampleTrajectory(r,T+1000,s)!;
 vector(state.positionAU,add(s.bodies[0].positionAU,position(1)));vector(state.relativePositionAU,position(1));vector(state.velocityAUPerSecond!,velocity(1));assert.equal(state.epochMs,T+1000);assert.equal(state.viewDistanceAU,r.displayRadiusAU);assert.equal(state.kind,'ephemeris');assert.equal(state.quality,'predicted');assert.equal((state as any).radiusKm,undefined);assert.deepEqual(clone(s),before);
 const moved=snapshot(T+1000,body('jupiter',[11,-3,9]));vector(subtract(sampleTrajectory(r,T+1000,moved)!.positionAU,state.positionAU),[6,-5,6]);
});
test('snapshot mismatch, missing/nonfinite center and unavailable records hide rather than mix epochs',()=>{
 assert.equal(sampleTrajectory(fixture(),T+1,snapshot()),null);assert.equal(sampleTrajectory(fixture(),T,snapshot(T,body('earth'))),null);assert.equal(sampleTrajectory(fixture(),T,snapshot(T,body('jupiter',[NaN,0,0]))),null);assert.equal(sampleTrajectory(unavailable,T,snapshot()),null);
});
test('Sun-relative trajectories use the actual heliocentric origin, no artificial body offset',()=>{const r={...fixture(),centerBodyId:'sun'};vector(sampleTrajectory(r,T,snapshot(T,body('sun',[9,9,9])))!.positionAU,position(0));vector(sampleTrajectory(r,T,{date:new Date(T),bodies:[]})!.positionAU,position(0));});
test('historical site starts at inclusive source epoch; axis prime/east/north and altitude are spherical',()=>{
 const r=site(),b=body('mars'),s=snapshot(T,b),radius=b.radiusKm/AU_KM;
 assert.equal(sampleTrajectory(r,T-1,snapshot(T-1,b)),null);
 for(const [latitudeDeg,longitudeDeg,expected] of [[0,0,[radius,0,0]],[0,90,[0,0,radius]],[90,0,[0,radius,0]],[-90,0,[0,-radius,0]],[0,-90,[0,0,-radius]]] as [number,number,Vec3][]){const state=sampleTrajectory({...r,latitudeDeg,longitudeDeg},T,s)!;vector(state.relativePositionAU,expected);assert.equal(state.velocityAUPerSecond,null);assert.equal(state.quality,'historical-site');assert.equal(state.kind,'surface-site');}
 near(length(sampleTrajectory({...r,altitudeKm:1},T,s)!.relativePositionAU)*AU_KM,b.radiusKm+1,1e-9);
 assert.equal(sampleTrajectory(r,T,snapshot(T,{...b,axisPrime:[0,0,0]})),null);
 assert.equal(sampleTrajectory(r,T,snapshot(T,{...b,axisPrime:b.axisNorth})),null);
});
test('actual IAU world axes rotate historical fixed site, not a fabricated current rover track',()=>{
 const r={...site(),latitudeDeg:18.44,longitudeDeg:77.45};
 const first=sampleTrajectory(r,T,computeSpace(new Date(T)))!;
 for(const t of [T,T+3600000,T+86400000]){const s=computeSpace(new Date(t)),b=s.bodies.find(b=>b.id==='mars')!,state=sampleTrajectory(r,t,s)!,u=state.relativePositionAU.map(v=>v/length(state.relativePositionAU)) as Vec3;near(dot(u,b.axisNorth),Math.sin(r.latitudeDeg*Math.PI/180));near(dot(u,b.axisEast),Math.cos(r.latitudeDeg*Math.PI/180)*Math.sin(r.longitudeDeg*Math.PI/180));assert.equal(state.velocityAUPerSecond,null);if(t>T)assert.notDeepEqual(state.relativePositionAU,first.relativePositionAU);}
});
test('paths preserve all source endpoints by default and rebase each vertex to current center',()=>{
 const r=fixture(),s=snapshot(T+1000),path=trajectoryPath(r,s);assert.equal(path.length,3);path.forEach((p,i)=>vector(p,add(s.bodies[0].positionAU,r.samples[i].slice(1,4) as Vec3)));
 const two=trajectoryPath(r,s,2);assert.deepEqual(two,[path[0],path[2]]);assert.deepEqual(trajectoryPath(r,s,1),[]);assert.deepEqual(trajectoryPath(r,s,NaN),[]);
 const moved=snapshot(T+6000,body('jupiter',[9,9,9]));trajectoryPath(r,moved).forEach((p,i)=>vector(subtract(p,path[i]),[4,7,6]));
 assert.deepEqual(trajectoryPath(r,snapshot(T-1)),[]);assert.deepEqual(trajectoryPath({...r,maxGapSeconds:1},s),[]);assert.deepEqual(trajectoryPath(site(),snapshot()),[]);assert.deepEqual(trajectoryPath(unavailable,snapshot()),[]);
});
test('default time is explicit source representative epoch/site epoch, unavailable stays null',()=>{assert.equal(trajectoryDefaultTime(fixture()),T+2000);assert.equal(trajectoryDefaultTime(site()),T);assert.equal(trajectoryDefaultTime(unavailable),null);});
