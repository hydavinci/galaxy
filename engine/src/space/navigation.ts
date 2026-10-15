import type {SpacecraftTarget} from './spacecraft-target';
import { AU_KM, type CatalogStar3D, type SpaceBody, type SpaceCamera, type SpaceSnapshot, type SpaceView, type Vec3 } from './types';
import { observeBody, validateSpaceDate } from './world';
import { getStellarModel } from './stellar-model';
import { MAX_COORDINATE_AU, add, cameraBasis, clamp, cross, directionAngles, faceCamera, rotateCamera, signedDegrees, distance, dot, finitePosition, finiteVector, length, normalize, normalizedOr, scale, subtract, wrapDegrees } from './math';

type Target = SpaceBody | CatalogStar3D | SpacecraftTarget;
export interface SelectedTargetInfo {
  id:string; name:string; kind:'star'|'planet'|'moon'|'spacecraft'; distanceAU:number;
  altitudeAU:number|null; radiusAU:number|null; angularDiameterRad:number|null; illuminatedFraction:number|null;
}
interface Flight { points:Vec3[]; elapsed:number; duration:number; }
interface Obstacle { positionAU:Vec3; safeRadius:number; }
interface StellarObstacle extends Obstacle { id:string; }
export const MAX_SPEED_AU_PER_SECOND=1000;
export const MIN_SPEED_AU_PER_SECOND=1e-10;
export const COLLISION_RADIUS_RATIO=1.05;
export const STAR_STANDOFF_AU=100;
const isCraft = (target:Target):target is SpacecraftTarget=>'kind' in target&&target.kind==='spacecraft';
const isBody = (target: Target): target is SpaceBody => 'radiusKm' in target;
const cloneTarget = <T extends Target>(t:T): T => ({...t,positionAU:[...t.positionAU]}) as T;
const finiteNumber = (n:number,label:string): void => {if(!Number.isFinite(n))throw new RangeError(`Invalid ${label}`);};

/** Stable closest-approach segment/sphere hit, avoiding b²-4ac cancellation. */
function segmentHit(from:Vec3,to:Vec3,center:Vec3,radius:number): number|null {
  const delta=subtract(to,from),span=length(delta);if(span===0)return null;
  const u=scale(delta,1/span),offset=subtract(from,center),along=-dot(offset,u);if(along<0)return null;
  const perpendicular=length(add(offset,scale(u,along)));if(perpendicular>=radius)return null;
  const half=Math.sqrt(Math.max(0,(radius-perpendicular)*(radius+perpendicular))),entry=along-half;
  if(entry>span || along+half<0)return null;return clamp(entry/span,0,1);
}

/** Pure spatial navigation: no DOM, RAF, timers, persistence or inertia. */
export class Navigation {
  private snapshot:SpaceSnapshot;
  private stars=new Map<string,CatalogStar3D>();
 private spacecraft=new Map<string,SpacecraftTarget>();
  private stellarObstacles:StellarObstacle[]=[];
  private state:SpaceView={camera:{positionAU:[0,0,0],azimuthDeg:0,altitudeDeg:0,fovDeg:60},selectedId:'earth',mode:'orbit',speedAUPerSecond:1e-5};
  private flight:Flight|null=null;
  private observation:{id:string;offsetAU:Vec3;viewDistanceAU:number}|null=null;
  private speedRatio=1;
  private explicitSpeed:number|null=null;
  constructor(snapshot:SpaceSnapshot,stars:CatalogStar3D[]=[]){this.snapshot=this.validSnapshot(snapshot);this.setStars(stars);this.resetEarth();}
  get view():SpaceView{return this.getView();}
  get camera():SpaceCamera{return this.getView().camera;}
  get selectedTarget():Target|null{return this.getSelectedTarget();}
  get isFlying():boolean{return this.flight!==null;}
  get spacecraftViewMode():'observe'|'follow'|null {const target=this.target();return target&&isCraft(target)?this.observation?.id===target.id?'observe':'follow':null;}
  getView():SpaceView{return {...this.state,camera:{...this.state.camera,positionAU:[...this.state.camera.positionAU]}};}
  getSelectedTarget():Target|null {const t=this.target();return t ? cloneTarget(t) : null;}
  getSelectedInfo():SelectedTargetInfo|null {
    const target=this.target();if(!target)return null;
    if(isBody(target)) {
      const m=observeBody(target,this.state.camera.positionAU,this.snapshot.bodies.find(b=>b.id==='sun')?.positionAU);
      return {id:target.id,name:target.name,kind:target.kind,distanceAU:m.distanceAU,altitudeAU:m.altitudeAU,radiusAU:m.radiusAU,angularDiameterRad:m.angularDiameterRad,illuminatedFraction:m.illuminatedFraction};
    }
    const distanceAU=distance(this.state.camera.positionAU,target.positionAU),radiusAU=this.radiusAU(target);
    return {id:target.id,name:!isCraft(target)&&target.nameZh||target.name,kind:isCraft(target)?'spacecraft':'star',distanceAU,altitudeAU:radiusAU===null?null:distanceAU-radiusAU,radiusAU,angularDiameterRad:radiusAU===null?null:2*Math.asin(clamp(radiusAU/distanceAU,0,1)),illuminatedFraction:null};
  }
  setSnapshot(snapshot:SpaceSnapshot,spacecraft?:readonly SpacecraftTarget[]):void {
    const next=this.validSnapshot(snapshot),previous=this.orbitReference();if(spacecraft)this.replaceSpacecraft(spacecraft);this.snapshot=next;const current=this.orbitReference();
    // Only orbit mode transports target translation. Free camera never resets.
    if(this.state.mode==='orbit' && previous && current) {
      const delta=subtract(current.positionAU,previous.positionAU);this.state.camera.positionAU=add(this.state.camera.positionAU,delta);
      if(this.flight)this.flight.points=this.flight.points.map(p=>add(p,delta));
    }
    if(!current){this.state.selectedId=null;this.observation=null;this.stop();}
    this.state.camera.positionAU=this.guardPoint(this.state.camera.positionAU);
    if(this.state.mode==='orbit' && current)this.face(current.positionAU);this.refreshSpeed();
  }
  private replaceSpacecraft(craft:readonly SpacecraftTarget[]):void {
    const next=new Map<string,SpacecraftTarget>();if(!Array.isArray(craft)||craft.length>12)throw new RangeError('Invalid spacecraft collection');
    for(const t of craft){if(t.kind!=='spacecraft'||t.id!==`craft:${t.missionId}`||next.has(t.id)||!t.name||!Number.isFinite(t.viewDistanceAU)||t.viewDistanceAU<1e-8||t.viewDistanceAU>1000)throw new RangeError('Invalid spacecraft target');finitePosition(t.positionAU);next.set(t.id,cloneTarget(t));}this.spacecraft=next;
  }
  setSpacecraft(craft:readonly SpacecraftTarget[]):void {this.setSnapshot(this.snapshot,craft);}
  setStars(stars:CatalogStar3D[]):void {
    if(!Array.isArray(stars))throw new RangeError('Invalid star collection');const next=new Map<string,CatalogStar3D>();
    for(const star of stars) {
      if(!star || typeof star.id!=='string' || !star.id || this.snapshot.bodies.some(b=>b.id===star.id) || next.has(star.id) ||
        !Number.isFinite(star.distancePc) || !(star.distancePc>0) || !Number.isFinite(star.absoluteMagnitude) || !Number.isFinite(star.bv))continue;
      try {finitePosition(star.positionAU);}catch{continue;}
      if(!(length(star.positionAU)>0))continue;next.set(star.id,cloneTarget(star));
    }
    this.stars=next;this.stellarObstacles=[];
    for(const star of next.values()){const radiusAU=this.radiusAU(star);if(radiusAU!==null)this.stellarObstacles.push({id:star.id,positionAU:star.positionAU,safeRadius:radiusAU*COLLISION_RADIUS_RATIO});}
    if(this.state.selectedId && !this.target()){this.state.selectedId=null;this.stop();}
  }
  selectTarget(id:string,fly=true):boolean {
    const target=this.find(id);if(!target)return false;this.stop();this.observation=null;this.state.selectedId=id;this.state.mode='orbit';
    // A free camera can already be at a catalog point before selecting it.
    // Establish that target's non-surface stand-off before constructing a ray.
    this.state.camera.positionAU=this.guardPoint(this.state.camera.positionAU);
    if(fly) {
      const from=[...this.state.camera.positionAU] as Vec3,center=isCraft(target)?this.snapshot.bodies.find(b=>b.id===target.centerBodyId):undefined;
      // Landed/low-orbit targets are approached from outside the host body, not
      // through its surface. This is camera framing, not spacecraft propagation.
      const radial=isCraft(target)&&center?normalizedOr(subtract(target.positionAU,center.positionAU),this.daylitOffset(target)):normalizedOr(subtract(from,target.positionAU),this.daylitOffset(target));
      const radiusAU=this.radiusAU(target),desired=isCraft(target)?target.viewDistanceAU:radiusAU!==null ? radiusAU*(isBody(target)&&id==='saturn'?7:4.5) : this.starStandoff(target as CatalogStar3D)*2;
      const end=this.guardPoint(add(target.positionAU,scale(radial,desired)));
      this.flight={points:this.flightRoute(from,end),elapsed:0,duration:3.5};
    }
    this.face(target.positionAU);this.refreshSpeed();return true;
  }
  /** Keep the selected craft's real state/info but observe a fixed source-window
   * reference point in its center body's translating frame. Time then moves the
   * craft through the path rather than carrying the camera with the craft. */
  observeSpacecraft(id:string,offsetAU:Vec3,viewDistanceAU:number,direction:Vec3,fly=true):boolean {
    const target=this.find(id);if(!target||!isCraft(target)||!this.snapshot.bodies.some(b=>b.id===target.centerBodyId))return false;
    finitePosition(offsetAU);finiteVector(direction,'observation direction');finiteNumber(viewDistanceAU,'observation distance');
    if(!(viewDistanceAU>=1e-8&&viewDistanceAU<=MAX_COORDINATE_AU/4)||!(length(direction)>0))throw new RangeError('Invalid observation frame');
    this.stop();this.state.selectedId=id;this.state.mode='orbit';this.observation={id,offsetAU:[...offsetAU],viewDistanceAU};
    this.state.camera.positionAU=this.guardPoint(this.state.camera.positionAU);const anchor=this.orbitReference()!;
    if(fly){const end=this.guardPoint(add(anchor.positionAU,scale(normalize(direction),viewDistanceAU)));this.flight={points:this.flightRoute([...this.state.camera.positionAU],end),elapsed:0,duration:3.5};}
    this.face(anchor.positionAU);this.refreshSpeed();return true;
  }
  update(dt:number,keys?:ReadonlySet<string>):void {
    const seconds=this.timeStep(dt);
    if(keys && keys.size) {
      const held=(...names:string[])=>names.some(name=>keys.has(name));
      const local:Vec3=[Number(held('KeyD','d','D','ArrowRight'))-Number(held('KeyA','a','A','ArrowLeft')),
        Number(held('KeyE','e','E'))-Number(held('KeyQ','q','Q')),
        Number(held('KeyW','w','W','ArrowUp'))-Number(held('KeyS','s','S','ArrowDown'))];
      if(length(local)>0)this.move(local,seconds,held('Shift','ShiftLeft','ShiftRight'));
    }
    if(this.flight && seconds>0) {
      const f=this.flight;f.elapsed=Math.min(f.duration,f.elapsed+seconds);
      const scaled=f.elapsed/f.duration*(f.points.length-1),index=Math.min(f.points.length-2,Math.floor(scaled));
      const t=clamp(scaled-index,0,1),smooth=t*t*(3-2*t),a=f.points[index],b=f.points[index+1],span=distance(a,b);
      const target=this.orbitReference(),r=target ? isCraft(target)?target.viewDistanceAU:this.radiusAU(target)??STAR_STANDOFF_AU:STAR_STANDOFF_AU;
      // Bounded log-distance approach, exact arrival; exploration, not dynamics.
      const progress=span>0 ? 1-Math.expm1(Math.log1p(span/r)*(1-smooth))*r/span : 1;
      const wanted=add(a,scale(subtract(b,a),clamp(progress,0,1))),actual=this.sweep(this.state.camera.positionAU,wanted);
      this.state.camera.positionAU=actual;
      if(distance(actual,wanted)>Math.max(1e-12,span*1e-12) || f.elapsed===f.duration)this.flight=null;
      if(target)this.face(target.positionAU);
    }
    this.refreshSpeed();
  }
  orbit(dx:number,dy:number,width:number,height:number):void {
    this.validateDrag(dx,dy,width,height);const target=this.orbitReference();if(!target){this.look(dx,dy,width,height);return;}
    // Grab-style orbit: the visible near-side surface follows horizontal drag.
    const horizontal=-dx/width*180,vertical=-dy/height*180;
    const angle=Math.hypot(horizontal,vertical);finiteNumber(angle,'orbit rotation');
    this.stop();this.state.mode='orbit';this.face(target.positionAU);
    if(angle===0){this.refreshSpeed();return;}
    // Repeated turns traverse the same fixed-axis circle: collision-check one
    // full revolution plus the remainder, never unbounded work or >5° chords.
    const sweepAngle=angle>360?360+angle%360:angle;
    const start=this.state.camera,r=distance(start.positionAU,target.positionAU),steps=Math.max(1,Math.ceil(sweepAngle/5));
    // Short chords check OTHER obstacles, never selected sphere (true arc is r).
    for(let i=1;i<=steps;i++) {
      const progress=(sweepAngle/angle)*i/steps,orientation=rotateCamera(start,horizontal*progress,vertical*progress);
      const wanted=add(target.positionAU,scale(cameraBasis(orientation).forward,-r)),actual=this.sweep(this.state.camera.positionAU,wanted,target.id);
      if(distance(actual,wanted)>1e-12)break;this.state.camera={...this.state.camera,...orientation,positionAU:wanted};
    }
    this.refreshSpeed();
  }
  /** Screen-plane camera translation. The scene follows the mouse; scale is
   * captured at gesture start, not re-estimated as the camera moves sideways. */
  pan(dx:number,dy:number,width:number,height:number,referenceDistanceAU?:number):void {
    this.validateDrag(dx,dy,width,height);const target=this.target();
    const reference=referenceDistanceAU??(target?distance(this.state.camera.positionAU,target.positionAU):Math.max(1e-8,this.state.speedAUPerSecond*3));
    finiteNumber(reference,'pan reference distance');if(!(reference>0))throw new RangeError('Pan reference distance must be positive');
    const units=2*reference*Math.tan(this.state.camera.fovDeg*Math.PI/360)/height,basis=cameraBasis(this.state.camera);
    const delta=add(scale(basis.right,-dx*units),scale(basis.up,dy*units));finitePosition(delta);
    if(dx===0&&dy===0)return;this.stop();this.state.mode='free';
    this.state.camera.positionAU=this.sweep(this.state.camera.positionAU,add(this.state.camera.positionAU,delta));this.refreshSpeed();
  }
  look(dx:number,dy:number,width:number,height:number):void {
    this.validateDrag(dx,dy,width,height);
    const orientation=rotateCamera(this.state.camera,dx/height*this.state.camera.fovDeg,dy/height*this.state.camera.fovDeg);
    this.stop();this.state.mode='free';Object.assign(this.state.camera,orientation);
  }
  dolly(factor:number):void {
    finiteNumber(factor,'dolly factor');if(!(factor>0))throw new RangeError('Dolly factor must be positive');this.stop();factor=clamp(factor,.01,100);
    const target=this.orbitReference(),from=this.state.camera.positionAU;
    if(this.state.mode==='orbit' && target) {
      const offset=subtract(from,target.positionAU),minimum=this.safeRadius(target)*1.000001,radius=clamp(length(offset)*factor,minimum,MAX_COORDINATE_AU/4);
      this.state.camera.positionAU=this.sweep(from,add(target.positionAU,scale(normalizedOr(offset,[0,0,1]),radius)));this.face(target.positionAU);
    } else {
      const stride=this.state.speedAUPerSecond*3*Math.log(factor);
      this.state.camera.positionAU=this.sweep(from,add(from,scale(cameraBasis(this.state.camera).forward,-stride)));
    }
    this.refreshSpeed();
  }
  move(local:Vec3,dt:number,boost:boolean|number=false):void {
    finiteVector(local,'local movement');const seconds=this.timeStep(dt),multiplier=typeof boost==='boolean'?(boost?10:1):boost;
    if(!Number.isFinite(multiplier)||multiplier<=0)throw new RangeError('Invalid boost');const magnitude=length(local);if(magnitude===0||seconds===0)return;
    this.stop();this.state.mode='free';this.refreshSpeed();const input=scale(local,1/Math.max(1,magnitude)),basis=cameraBasis(this.state.camera);
    const direction=add(add(scale(basis.right,input[0]),scale(basis.up,input[1])),scale(basis.forward,input[2]));
    const speed=Math.min(MAX_SPEED_AU_PER_SECOND,this.state.speedAUPerSecond*multiplier);
    this.state.camera.positionAU=this.sweep(this.state.camera.positionAU,add(this.state.camera.positionAU,scale(direction,speed*seconds)));this.refreshSpeed();
  }
  setMode(mode:SpaceView['mode']):void {
    if(mode!=='orbit'&&mode!=='free')throw new RangeError('Invalid navigation mode');this.stop();this.state.mode=mode;
    const target=this.orbitReference();if(mode==='orbit'&&target)this.face(target.positionAU);
  }
  setSpeed(auPerSecond:number):void {
    finiteNumber(auPerSecond,'speed');if(auPerSecond<=0)throw new RangeError('Speed must be positive');
    this.explicitSpeed=clamp(auPerSecond,MIN_SPEED_AU_PER_SECOND,MAX_SPEED_AU_PER_SECOND);this.refreshSpeed();
  }
  setSpeedRatio(ratio:number):void {
    finiteNumber(ratio,'speed ratio');if(ratio<=0)throw new RangeError('Speed ratio must be positive');
    this.speedRatio=clamp(ratio,.01,1000);this.explicitSpeed=null;this.refreshSpeed();
  }
  setSpeedMultiplier(ratio:number):void{this.setSpeedRatio(ratio);}
  setCamera(camera:SpaceCamera):void {
    finitePosition(camera.positionAU);finiteNumber(camera.azimuthDeg,'yaw');finiteNumber(camera.altitudeDeg,'pitch');finiteNumber(camera.rollDeg??0,'roll');finiteNumber(camera.fovDeg,'FOV');this.stop();
    this.state.camera={positionAU:this.guardPoint([...camera.positionAU]),azimuthDeg:wrapDegrees(camera.azimuthDeg),altitudeDeg:signedDegrees(camera.altitudeDeg),rollDeg:signedDegrees(camera.rollDeg??0),fovDeg:clamp(camera.fovDeg,30,90)};this.refreshSpeed();
  }
  frameSystem():void {
    this.stop();this.observation=null;this.state.selectedId='sun';this.state.mode='free';
    const positionAU=scale(normalize([.2,.55,1]),40);
    this.state.camera={positionAU,...directionAngles(scale(positionAU,-1)),fovDeg:60};this.refreshSpeed();
  }
  resetEarth():void {
    const earth=this.snapshot.bodies.find(b=>b.id==='earth');if(!earth)throw new RangeError('Earth is required for reset');
    this.stop();this.observation=null;this.state.selectedId='earth';this.state.mode='orbit';this.explicitSpeed=null;this.speedRatio=1;
    this.state.camera={positionAU:add(earth.positionAU,scale(this.daylitOffset(earth),4.5*earth.radiusKm/AU_KM)),azimuthDeg:0,altitudeDeg:0,fovDeg:60};
    this.state.camera.positionAU=this.guardPoint(this.state.camera.positionAU);Object.assign(this.state.camera,directionAngles(subtract(earth.positionAU,this.state.camera.positionAU)));this.refreshSpeed();
  }
  clearSpacecraftSelection():void{if(this.state.selectedId?.startsWith('craft:')){this.observation=null;this.state.selectedId=null;this.state.mode='free';this.stop();this.refreshSpeed();}}
  stop():void{this.flight=null;}
  dispose():void{this.stop();this.observation=null;this.stars.clear();this.spacecraft.clear();this.stellarObstacles=[];}
  private target():Target|null{return this.state.selectedId?this.find(this.state.selectedId):null;}
  private orbitReference():Target|null {
    const target=this.target();if(!target||!isCraft(target)||this.observation?.id!==target.id)return target;
    const center=this.snapshot.bodies.find(b=>b.id===target.centerBodyId);return center?{...target,positionAU:add(center.positionAU,this.observation.offsetAU),viewDistanceAU:this.observation.viewDistanceAU}:null;
  }
  private find(id:string):Target|null{return this.snapshot.bodies.find(b=>b.id===id)??this.stars.get(id)??this.spacecraft.get(id)??null;}
  private starStandoff(target:CatalogStar3D):number{return Math.max(STAR_STANDOFF_AU,length(target.positionAU)*1e-9);}
  private radiusAU(target:Target):number|null {if(isCraft(target))return null;if(isBody(target))return target.radiusKm/AU_KM;const model=getStellarModel(target);return model?model.radiusKm/AU_KM:null;}
  private safeRadius(target:Target):number {if(isCraft(target))return Math.max(1e-9,target.viewDistanceAU*.005);const r=this.radiusAU(target);return r!==null?r*COLLISION_RADIUS_RATIO:this.starStandoff(target as CatalogStar3D);}
  private face(position:Vec3):void {const d=subtract(position,this.state.camera.positionAU);if(length(d)>0)Object.assign(this.state.camera,faceCamera(this.state.camera,d));}
  private daylitOffset(target:Target):Vec3 {
    const sunward=normalizedOr(scale(target.positionAU,-1),[0,0,1]),north=isBody(target)?target.axisNorth:[0,1,0] as Vec3;
    const side=normalizedOr(cross(sunward,north),[1,0,0]),above=normalize(cross(side,sunward));return normalize(add(add(sunward,scale(side,.42)),scale(above,.25)));
  }
  private refreshSpeed():void {
    if(this.explicitSpeed!==null){this.state.speedAUPerSecond=this.explicitSpeed;return;}let nearest=Infinity;
    for(const body of this.snapshot.bodies)nearest=Math.min(nearest,Math.max(0,distance(this.state.camera.positionAU,body.positionAU)-body.radiusKm/AU_KM));
    const target=this.target();if(target&&!isBody(target)){const radius=this.radiusAU(target);nearest=Math.min(nearest,radius===null?Math.max(isCraft(target)?1e-8:1,distance(this.state.camera.positionAU,target.positionAU)-(isCraft(target)?0:this.starStandoff(target))):Math.max(0,distance(this.state.camera.positionAU,target.positionAU)-radius));}
    this.state.speedAUPerSecond=clamp(Math.max(1e-8,nearest*.6)*this.speedRatio,MIN_SPEED_AU_PER_SECOND,MAX_SPEED_AU_PER_SECOND);
  }
  private obstacles(exceptId?:string,from:Vec3=this.state.camera.positionAU,to:Vec3=from):Obstacle[] {
    const result:Obstacle[]=this.snapshot.bodies.filter(b=>b.id!==exceptId).map(b=>({positionAU:b.positionAU,safeRadius:this.safeRadius(b)}));
    // Static catalog spheres, broad-phase bounded by the actual travel segment.
    // Do not fabricate binary separation: co-located components share one
    // conservative collision envelope; orbit must skip that same-center group.
    const orbitTarget=exceptId?this.stars.get(exceptId):undefined,selected=this.state.selectedId?this.stars.get(this.state.selectedId):undefined;
    for(const o of this.stellarObstacles){
      if(o.id===exceptId||orbitTarget&&o.positionAU.every((v,i)=>v===orbitTarget.positionAU[i]))continue;
      // Catalog-coincident components have no resolved physical separation.
      // Inspect the selected representative, matching stellar rendering, rather
      // than inventing a larger companion enclosing its photosphere.
      if(selected&&o.id!==selected.id&&o.positionAU.every((v,i)=>v===selected.positionAU[i]))continue;
      const radius=o.safeRadius*1.00001;let misses=false;
      for(let i=0;i<3;i++)if(o.positionAU[i]+radius<Math.min(from[i],to[i])||o.positionAU[i]-radius>Math.max(from[i],to[i])){misses=true;break;}
      if(!misses)result.push(o);
    }
    const target=this.target();if(target&&!isBody(target)&&!isCraft(target)&&target.id!==exceptId&&this.radiusAU(target)===null)result.push({positionAU:target.positionAU,safeRadius:this.safeRadius(target)});return result;
  }
  private guardPoint(position:Vec3):Vec3 {
    let p=position.map(n=>clamp(n,-MAX_COORDINATE_AU,MAX_COORDINATE_AU)) as Vec3;
    for(const o of this.obstacles(undefined,p,p)) {
      const delta=subtract(p,o.positionAU),minimum=o.safeRadius;
      if(length(delta)<minimum*1.000001)p=add(o.positionAU,scale(normalizedOr(delta,[0,0,1]),minimum*1.000001));
    }
    return p;
  }
  private sweep(from:Vec3,to:Vec3,exceptId?:string):Vec3 {
    to=to.map(n=>clamp(n,-MAX_COORDINATE_AU,MAX_COORDINATE_AU)) as Vec3;let hit=1;
    for(const o of this.obstacles(exceptId,from,to)) {const t=segmentHit(from,to,o.positionAU,o.safeRadius*1.000001);if(t!==null)hit=Math.min(hit,t);}
    const span=distance(from,to),margin=span?Math.min(1e-7,1e-12/span):0;
    return add(from,scale(subtract(to,from),Math.max(0,hit-(hit<1?margin:0))));
  }
  private flightRoute(from:Vec3,end:Vec3):Vec3[] {
    const points:Vec3[]=[from,end],obstacles=this.obstacles(undefined,from,end);
    // Bounded geometric detours, NOT fuel/acceleration-constrained trajectories.
    for(let insertion=0;insertion<24;insertion++) {
      let inserted=false;
      for(let i=0;i<points.length-1&&!inserted;i++)for(const o of obstacles) {
        const a=points[i],b=points[i+1];if(segmentHit(a,b,o.positionAU,o.safeRadius*1.00001)===null)continue;
        const axis=normalizedOr(subtract(b,a),[0,0,1]),closest=add(a,scale(axis,dot(subtract(o.positionAU,a),axis)));
        const side=normalizedOr(subtract(closest,o.positionAU),normalizedOr(cross(axis,[0,1,0]),[1,0,0]));
        points.splice(i+1,0,add(o.positionAU,scale(side,o.safeRadius*3)));inserted=true;break;
      }
      if(!inserted)break;
    }
    return points;
  }
  private timeStep(dt:number):number{finiteNumber(dt,'elapsed time');return clamp(dt,0,.25);}
  private validateDrag(dx:number,dy:number,width:number,height:number):void {
    [dx,dy,width,height].forEach(n=>finiteNumber(n,'drag'));if(!(width>0&&height>0))throw new RangeError('Drag dimensions must be positive');
  }
  private validSnapshot(snapshot:SpaceSnapshot):SpaceSnapshot {
    if(!snapshot||!Array.isArray(snapshot.bodies))throw new RangeError('Invalid space snapshot');validateSpaceDate(snapshot.date);const ids=new Set<string>();
    for(const body of snapshot.bodies) {
      if(!body || ids.has(body.id) || !body.id || !(body.radiusKm>0) || !Number.isFinite(body.radiusKm))throw new RangeError('Invalid body');
      ids.add(body.id);finitePosition(body.positionAU);[body.axisNorth,body.axisPrime,body.axisEast].forEach(v=>finiteVector(v,'body axis'));
    }
    if(!ids.has('earth')||!ids.has('sun'))throw new RangeError('Snapshot requires Earth and Sun');
    return {date:new Date(snapshot.date.getTime()),bodies:snapshot.bodies.map(b=>({...b,positionAU:[...b.positionAU],axisNorth:[...b.axisNorth],axisPrime:[...b.axisPrime],axisEast:[...b.axisEast]}))};
  }
}
