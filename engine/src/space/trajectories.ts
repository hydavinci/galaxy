import { AU_KM, type SpaceSnapshot, type Vec3 } from './types';
import { add, dot, length, scale } from './math';

/** The published vectors already have EQJ Y/Z swapped. Do not swap a second time. */
export type TrajectorySample = readonly [number, number, number, number, number, number, number];
export interface TrajectorySourceQuery { readonly url:string; readonly sha256:string; }
interface RecordBase { readonly missionId:string; readonly label:string; readonly sourceUrl:string; readonly notes:string; }
export interface EphemerisTrajectoryRecord extends RecordBase {
  readonly kind:'ephemeris'; readonly centerBodyId:string; readonly sourceTarget:string;
  readonly sourceName:string; readonly solution:string; readonly quality:'reconstructed'|'predicted'|'mixed'|'tle-derived';
  readonly startMs:number; readonly endMs:number; readonly defaultMs:number; readonly sampleCount:number;
  readonly samples:readonly TrajectorySample[]; readonly interpolation:'cubic-hermite'; readonly maxGapSeconds:number;
  readonly maxInterpolationErrorKm:number; readonly validationSamples:number; readonly displayRadiusAU:number;
  readonly sourceQueries:readonly TrajectorySourceQuery[];
}
export interface SurfaceSiteTrajectoryRecord extends RecordBase {
  readonly kind:'surface-site'; readonly centerBodyId:string; readonly latitudeDeg:number; readonly longitudeDeg:number;
  readonly altitudeKm:number; readonly siteEpochMs:number; readonly sourceName:string; readonly quality:'historical-site';
}
export interface UnavailableTrajectoryRecord extends RecordBase { readonly kind:'unavailable'; }
export type TrajectoryRecord = EphemerisTrajectoryRecord | SurfaceSiteTrajectoryRecord | UnavailableTrajectoryRecord;
export interface TrajectoryDataset {
  readonly schemaVersion:1; readonly generatedAt:string; readonly frame:'ICRF_EQJ_Y_UP'; readonly units:'AU_AND_SECONDS';
  readonly notice:string; readonly records:readonly TrajectoryRecord[];
}
export interface CraftState {
  missionId:string; name:string; positionAU:Vec3; relativePositionAU:Vec3; velocityAUPerSecond:Vec3|null;
  centerBodyId:string; viewDistanceAU:number; quality:string; kind:'ephemeris'|'surface-site'; epochMs:number;
}
export const TRAJECTORY_FRAME_NOTICE = '中心天体共动坐标轨迹（非所有历史日心位置）';
export const MAX_TRAJECTORY_SAMPLES = 10000;
export const MAX_TRAJECTORY_RECORDS = 12;
export const TRAJECTORY_MISSION_IDS = Object.freeze(['voyager-1','voyager-2','cassini','juno','new-horizons','parker-solar-probe','lro','perseverance','tianwen-1','change-6','webb','hubble']);
const CENTERS = new Set(['sun','earth','moon','mars','jupiter','saturn','uranus','neptune','mercury','venus']);
const SITE_CENTERS:Readonly<Record<string,string>> = Object.freeze({'perseverance':'mars','tianwen-1':'mars','change-6':'moon'});
const MIN_TIME = Date.UTC(1900,0,1), MAX_TIME = Date.UTC(2101,0,1)-1;
const MAX_POSITION = 1e12;
const validVector = (v:readonly number[]):boolean => Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=MAX_POSITION);
function fail(message:string):never { throw new RangeError(`Invalid trajectory data: ${message}`); }
function object(value:unknown,keys:readonly string[],label:string):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail(label);
  const result=value as Record<string,unknown>,own=Object.keys(result);
  if(own.length!==keys.length||own.some(k=>!keys.includes(k)))fail(`${label} fields`);
  return result;
}
function text(value:unknown,label:string,max=8192):string {
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(label);
  return value;
}
function number(value:unknown,label:string,min:number,max:number,integer=false):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isSafeInteger(value)))fail(label);
  return value;
}
function time(value:unknown,label:string):number { return number(value,label,MIN_TIME,MAX_TIME,true); }
function sourceUrl(value:unknown):string {
  const raw=text(value,'source URL',16384);
  try { const url=new URL(raw); if(url.protocol!=='https:'||!url.hostname||url.username||url.password||/[\s<>]/.test(raw))fail('source URL'); }
  catch { fail('source URL'); }
  return raw;
}
const BASE_KEYS=['missionId','kind','label','sourceUrl','notes'];
/** Reject unknown fields and unreasonable bounds, then detach and freeze every
 * accepted object/tuple. Input mutation cannot invalidate a checked dataset.
 * This checks metadata consistency, NOT whether the remote source is truthful. */
export function validateTrajectoryData(input:unknown):TrajectoryDataset {
  const d=object(input,['schemaVersion','generatedAt','frame','units','notice','records'],'dataset');
  if(d.schemaVersion!==1||d.frame!=='ICRF_EQJ_Y_UP'||d.units!=='AU_AND_SECONDS')fail('version/frame/units');
  const generatedAt=text(d.generatedAt,'generatedAt',32),generated=Date.parse(generatedAt);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(generatedAt)||!Number.isFinite(generated)||new Date(generated).toISOString()!==(generatedAt.includes('.')?generatedAt:generatedAt.replace(/Z$/,'.000Z')))fail('generatedAt UTC');
  time(generated,'generatedAt');
  const notice=text(d.notice,'notice');
  if(!Array.isArray(d.records)||d.records.length>MAX_TRAJECTORY_RECORDS||!d.records.length)fail('records bound');
  const ids=new Set<string>();
  const records=d.records.map((raw:unknown):TrajectoryRecord=>{
    if(!raw||typeof raw!=='object')fail('record');
    const kind=(raw as Record<string,unknown>).kind;
    const extra=kind==='ephemeris'?['centerBodyId','sourceTarget','sourceName','solution','quality','startMs','endMs','defaultMs','sampleCount','samples','interpolation','maxGapSeconds','maxInterpolationErrorKm','validationSamples','displayRadiusAU','sourceQueries']
      :kind==='surface-site'?['centerBodyId','latitudeDeg','longitudeDeg','altitudeKm','siteEpochMs','sourceName','quality']:kind==='unavailable'?[]:fail('record kind');
    const r=object(raw,[...BASE_KEYS,...extra],'record'),missionId=text(r.missionId,'missionId',80);
    if(!TRAJECTORY_MISSION_IDS.includes(missionId)||ids.has(missionId))fail('unknown/duplicate missionId');
    ids.add(missionId);
    const base={missionId,label:text(r.label,'label',160),sourceUrl:sourceUrl(r.sourceUrl),notes:text(r.notes,'notes')};
    if(kind==='unavailable')return Object.freeze({...base,kind});
    const centerBodyId=text(r.centerBodyId,'centerBodyId',16),sourceName=text(r.sourceName,'sourceName',200);
    if(!CENTERS.has(centerBodyId))fail('centerBodyId');
    if(kind==='surface-site') {
      if(SITE_CENTERS[missionId]!==centerBodyId||r.quality!=='historical-site')fail('historical site mission/center/quality');
      return Object.freeze({...base,kind,centerBodyId,sourceName,quality:'historical-site',latitudeDeg:number(r.latitudeDeg,'latitudeDeg',-90,90),longitudeDeg:number(r.longitudeDeg,'longitudeDeg',-180,360),altitudeKm:number(r.altitudeKm,'altitudeKm',0,100),siteEpochMs:time(r.siteEpochMs,'siteEpochMs')});
    }
    if(r.interpolation!=='cubic-hermite'||!['reconstructed','predicted','mixed','tle-derived'].includes(r.quality as string))fail('interpolation/quality');
    const sourceTarget=text(r.sourceTarget,'sourceTarget',32);if(!/^-?\d+$/.test(sourceTarget))fail('sourceTarget');
    const startMs=time(r.startMs,'startMs'),endMs=time(r.endMs,'endMs'),defaultMs=time(r.defaultMs,'defaultMs');
    if(endMs<=startMs||defaultMs<startMs||defaultMs>endMs)fail('coverage/default epoch');
    const sampleCount=number(r.sampleCount,'sampleCount',2,MAX_TRAJECTORY_SAMPLES,true),maxGapSeconds=number(r.maxGapSeconds,'maxGapSeconds',.001,366*86400);
    if(!Array.isArray(r.samples)||r.samples.length!==sampleCount)fail('sample count');
    let previous=-Infinity;
    const samples=r.samples.map((sample:unknown):TrajectorySample=>{
      if(!Array.isArray(sample)||sample.length!==7)fail('sample tuple');
      const t=time(sample[0],'sample epoch');
      if(t<=previous||(Number.isFinite(previous)&&(t-previous)/1000>maxGapSeconds+1e-9))fail('sample order/gap');
      previous=t;
      return Object.freeze([t,...sample.slice(1,4).map(n=>number(n,'position AU',-MAX_POSITION,MAX_POSITION)),...sample.slice(4).map(n=>number(n,'velocity AU/s',-1,1))]) as TrajectorySample;
    });
    if(samples[0][0]!==startMs||samples[samples.length-1][0]!==endMs)fail('coverage endpoints');
    if(!Array.isArray(r.sourceQueries)||!r.sourceQueries.length||r.sourceQueries.length>64)fail('source query count');
    const sourceQueries=r.sourceQueries.map((raw:unknown)=>{const q=object(raw,['url','sha256'],'source query'),sha256=text(q.sha256,'source digest',64);if(!/^[a-f0-9]{64}$/.test(sha256))fail('source digest');return Object.freeze({url:sourceUrl(q.url),sha256});});
    return Object.freeze({...base,kind:'ephemeris',centerBodyId,sourceName,sourceTarget,solution:text(r.solution,'solution'),quality:r.quality as EphemerisTrajectoryRecord['quality'],startMs,endMs,defaultMs,sampleCount,samples:Object.freeze(samples),interpolation:'cubic-hermite',maxGapSeconds,maxInterpolationErrorKm:number(r.maxInterpolationErrorKm,'maxInterpolationErrorKm',0,1e9),validationSamples:number(r.validationSamples,'validationSamples',1,1e6,true),displayRadiusAU:number(r.displayRadiusAU,'displayRadiusAU',1e-12,1e6),sourceQueries:Object.freeze(sourceQueries)});
  });
  const result:TrajectoryDataset=Object.freeze({schemaVersion:1,generatedAt,frame:'ICRF_EQJ_Y_UP',units:'AU_AND_SECONDS',notice,records:Object.freeze(records)});
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>6000000)fail('6 MB serialized bound');
  return result;
}

/** Center-relative geometric position and its derivative; UTC milliseconds in,
 * AU and AU/second out. No local propagation, extrapolation or endpoint clamp. */
export function trajectoryPositionAt(record:TrajectoryRecord,utcMs:number):{positionAU:Vec3;velocityAUPerSecond:Vec3}|null {
  if(record.kind!=='ephemeris'||!Number.isFinite(utcMs)||utcMs<record.startMs||utcMs>record.endMs||record.samples.length<2||record.samples.length>MAX_TRAJECTORY_SAMPLES)return null;
  const samples=record.samples;
  let lo=0,hi=samples.length-1;
  while(lo<=hi) {
    const mid=(lo+hi)>>>1,knot=samples[mid];
    if(knot[0]===utcMs) {
      const positionAU=knot.slice(1,4) as Vec3,velocityAUPerSecond=knot.slice(4,7) as Vec3;
      return validVector(positionAU)&&validVector(velocityAUPerSecond)?{positionAU,velocityAUPerSecond}:null;
    }
    if(knot[0]<utcMs)lo=mid+1;else hi=mid-1;
  }
  if(hi<0||lo>=samples.length)return null;
  const a=samples[hi],b=samples[lo],seconds=(b[0]-a[0])/1000;
  if(!(seconds>0)||!Number.isFinite(record.maxGapSeconds)||seconds>record.maxGapSeconds+1e-9)return null;
  const u=(utcMs-a[0])/(b[0]-a[0]),u2=u*u,u3=u2*u;
  const positionAU=[0,0,0] as Vec3,velocityAUPerSecond=[0,0,0] as Vec3;
  for(let i=0;i<3;i++) {
    positionAU[i]=(2*u3-3*u2+1)*a[i+1]+(u3-2*u2+u)*seconds*a[i+4]+(-2*u3+3*u2)*b[i+1]+(u3-u2)*seconds*b[i+4];
    velocityAUPerSecond[i]=(6*u2-6*u)/seconds*a[i+1]+(3*u2-4*u+1)*a[i+4]+(-6*u2+6*u)/seconds*b[i+1]+(3*u2-2*u)*b[i+4];
  }
  return validVector(positionAU)&&validVector(velocityAUPerSecond)?{positionAU,velocityAUPerSecond}:null;
}
function centerPosition(centerBodyId:string,snapshot:SpaceSnapshot):Vec3|null {
  if(!CENTERS.has(centerBodyId))return null;
  if(centerBodyId==='sun')return [0,0,0];
  const center=snapshot.bodies.find(b=>b.id===centerBodyId)?.positionAU;
  return center&&validVector(center)?[...center]:null;
}
/** The snapshot must be at utcMs: use snapshot.date.getTime(), not the newer
 * uncommitted display clock. World position is ENGINE center + source vector;
 * relative velocity is not a heliocentric velocity and does not add center speed. */
export function sampleTrajectory(record:TrajectoryRecord,utcMs:number,snapshot:SpaceSnapshot):CraftState|null {
  if(record.kind==='unavailable'||!Number.isFinite(utcMs)||snapshot.date.getTime()!==utcMs)return null;
  const center=centerPosition(record.centerBodyId,snapshot);if(!center)return null;
  let relativePositionAU:Vec3,velocityAUPerSecond:Vec3|null,viewDistanceAU:number;
  if(record.kind==='ephemeris') {
    const state=trajectoryPositionAt(record,utcMs);if(!state)return null;
    relativePositionAU=state.positionAU;velocityAUPerSecond=state.velocityAUPerSecond;viewDistanceAU=record.displayRadiusAU;
  } else {
    if(utcMs<record.siteEpochMs)return null;
    const body=snapshot.bodies.find(b=>b.id===record.centerBodyId);
    if(!body||!(body.radiusKm>0)||![body.axisPrime,body.axisNorth,body.axisEast].every(v=>validVector(v)&&Math.abs(length(v)-1)<1e-6))return null;
    if(Math.abs(dot(body.axisPrime,body.axisNorth))+Math.abs(dot(body.axisPrime,body.axisEast))+Math.abs(dot(body.axisNorth,body.axisEast))>1e-6)return null;
    const lat=record.latitudeDeg*Math.PI/180,lon=record.longitudeDeg*Math.PI/180,r=(body.radiusKm+record.altitudeKm)/AU_KM;
    if(!(r>0)||!Number.isFinite(r))return null;
    relativePositionAU=scale(add(add(scale(body.axisPrime,Math.cos(lat)*Math.cos(lon)),scale(body.axisEast,Math.cos(lat)*Math.sin(lon))),scale(body.axisNorth,Math.sin(lat))),r);
    velocityAUPerSecond=null;viewDistanceAU=body.radiusKm/AU_KM*2;
  }
  const positionAU=add(center,relativePositionAU);
  if(!validVector(positionAU)||!validVector(relativePositionAU)||!(viewDistanceAU>0)||!Number.isFinite(viewDistanceAU))return null;
  return {missionId:record.missionId,name:record.label,positionAU,relativePositionAU,velocityAUPerSecond,centerBodyId:record.centerBodyId,viewDistanceAU,quality:record.quality,kind:record.kind,epochMs:utcMs};
}

/** Source-knot polyline, not a new physical orbit. All vertices use the CURRENT
 * engine center (the explicit moving-frame notice above). Default preserves all
 * <=10,000 source knots; a caller-requested smaller cap selects evenly spaced
 * knots including both endpoints and is only a coarser shape preview. The overlay
 * does not use this decimation. Invalid/gapped data and uncovered epochs hide. */
export function trajectoryPath(record:TrajectoryRecord,snapshot:SpaceSnapshot,maxPoints=MAX_TRAJECTORY_SAMPLES):Vec3[] {
  if(record.kind!=='ephemeris'||!Number.isInteger(maxPoints)||maxPoints<2||!sampleTrajectory(record,snapshot.date.getTime(),snapshot))return [];
  const center=centerPosition(record.centerBodyId,snapshot);if(!center)return [];
  const samples=record.samples;
  if(samples.some((s,i)=>!validVector(s.slice(1,4))||(i>0&&(s[0]<=samples[i-1][0]||(s[0]-samples[i-1][0])/1000>record.maxGapSeconds+1e-9))))return [];
  const count=Math.min(samples.length,maxPoints,MAX_TRAJECTORY_SAMPLES);
  return Array.from({length:count},(_,i)=>{const s=samples[Math.round(i*(samples.length-1)/(count-1))];return add(center,[s[1],s[2],s[3]]);});
}
export function trajectoryDefaultTime(record:TrajectoryRecord):number|null {
  return record.kind==='ephemeris'?record.defaultMs:record.kind==='surface-site'?record.siteEpochMs:null;
}
