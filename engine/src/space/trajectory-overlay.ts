import {patchText,patchHidden,patchAttribute} from './dom-patches';
import { AU_KM, type SpaceCamera, type SpaceSnapshot, type Vec3 } from './types';
import { add, cross, dot, length, scale, subtract, type CameraBasis } from './math';
import { projectSpace, spaceCameraBasis, validCamera } from './render-math';
import { MAX_TRAJECTORY_RECORDS, MAX_TRAJECTORY_SAMPLES, TRAJECTORY_FRAME_NOTICE, TRAJECTORY_MISSION_IDS, sampleTrajectory, type CraftState, type EphemerisTrajectoryRecord, type TrajectoryRecord } from './trajectories';

const SVG_NS='http://www.w3.org/2000/svg';
const NEAR_AU=1e-12; // numerical clipping plane (~0.15 m), never a spacecraft radius
const MAX_FRAGMENTS=10000;
let nextOverlayId=0;
interface Sphere { center:Vec3; radius:number; tolerance:number; }
interface ProjectionContext { camera:SpaceCamera; basis:CameraBasis; width:number; height:number; tan:number; spheres:Sphere[]; pathSpheres:Sphere[]; }
export type TrajectoryScreenSegment = readonly [number,number,number,number];
const finite=(v:Vec3):boolean=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=2e12);
function context(snapshot:SpaceSnapshot,camera:SpaceCamera,width:number,height:number):ProjectionContext|null {
  if(!validCamera(camera)||!finite(camera.positionAU)||!(width>0&&height>0)||!Number.isFinite(width+height)||width>1e7||height>1e7)return null;
  const spheres:Sphere[]=[];
  // The scientific snapshot contains the ten supported Solar-system bodies.
  for(const body of snapshot.bodies.slice(0,10)) {
    const radius=body.radiusKm/AU_KM;
    if(!finite(body.positionAU)||!(radius>0)||!Number.isFinite(radius))continue;
    const center=subtract(body.positionAU,camera.positionAU);
    const tolerance=Math.max(radius*1e-8,32*Number.EPSILON*Math.max(...body.positionAU.map(Math.abs),...camera.positionAU.map(Math.abs),radius));
    spheres.push({center,radius,tolerance});
  }
  const basis=spaceCameraBasis(camera),tan=Math.tan(camera.fovDeg*Math.PI/360),tx=tan*width/height;
  // A path segment is clipped into this view pyramid before visibility tests.
  // A sphere completely outside any pyramid plane cannot occult that segment.
  // Keep all spheres for arbitrary-point queries (which may be offscreen).
  const pathSpheres=spheres.filter(s=>{const x=dot(s.center,basis.right),y=dot(s.center,basis.up),z=dot(s.center,basis.forward),r=s.radius+s.tolerance;
    return z+r>=NEAR_AU&&z*tx+x+r*Math.hypot(tx,1)>=0&&z*tx-x+r*Math.hypot(tx,1)>=0&&z*tan+y+r*Math.hypot(tan,1)>=0&&z*tan-y+r*Math.hypot(tan,1)>=0;});
  return {camera,basis,width,height,tan,spheres,pathSpheres};
}
/** Nearest physical sphere intersection along camera -> point. Cross-track
 * subtraction, rather than |c|²-(c·u)², retains small limbs at large distances.
 * Surface tolerance only absorbs double roundoff; it is not a visible halo. */
function occludedRelative(point:Vec3,spheres:readonly Sphere[]):boolean {
  const distance=length(point);if(!(distance>0)||!Number.isFinite(distance))return true;
  const direction=scale(point,1/distance);
  let nearest=Infinity;
  for(const sphere of spheres) {
    const {center,radius,tolerance}=sphere;
    if(length(center)<radius-tolerance)return true;
    const along=dot(center,direction);if(along<0)continue;
    const offset=length(subtract(center,scale(direction,along)));
    if(offset>radius+tolerance)continue;
    const entry=along-Math.sqrt(Math.max(0,(radius-offset)*(radius+offset)));
    if(entry>=-tolerance&&entry<distance-tolerance)nearest=Math.min(nearest,Math.max(0,entry));
  }
  return Number.isFinite(nearest);
}
export function isTrajectoryPointOccluded(positionAU:Vec3,snapshot:SpaceSnapshot,camera:SpaceCamera):boolean {
  const c=context(snapshot,camera,1,1);return !c||!finite(positionAU)||occludedRelative(subtract(positionAU,camera.positionAU),c.spheres);
}
/** Clip a source segment in homogeneous camera coordinates BEFORE perspective
 * division: near, left/right and top/bottom. This also retains crossings whose
 * two endpoints are both outside the viewport or one is behind the camera. */
function clip(a:Vec3,b:Vec3,c:ProjectionContext):[Vec3,Vec3]|null {
  const delta=subtract(b,a),{right,up,forward}=c.basis,tx=c.tan*c.width/c.height;
  const x=dot(a,right),y=dot(a,up),z=dot(a,forward),dx=dot(delta,right),dy=dot(delta,up),dz=dot(delta,forward);
  let lo=0,hi=1;
  for(const [value,slope] of [[z-NEAR_AU,dz],[z*tx+x,dz*tx+dx],[z*tx-x,dz*tx-dx],[z*c.tan+y,dz*c.tan+dy],[z*c.tan-y,dz*c.tan-dy]]) {
    if(!Number.isFinite(value+slope))return null;
    if(slope===0){if(value<0)return null;continue;}
    const edge=-value/slope;
    if(slope>0)lo=Math.max(lo,edge);else hi=Math.min(hi,edge);
    if(lo>hi)return null;
  }
  return [add(a,scale(delta,lo)),add(a,scale(delta,hi))];
}
function roots(a:number,b:number,c:number,result:number[]):void {
  const magnitude=Math.max(Math.abs(a),Math.abs(b),Math.abs(c));if(!(magnitude>0)||!Number.isFinite(magnitude))return;
  a/=magnitude;b/=magnitude;c/=magnitude;
  const push=(v:number)=>{if(Number.isFinite(v)&&v>0&&v<1)result.push(v);};
  if(Math.abs(a)<1e-15){if(Math.abs(b)>1e-15)push(-c/b);return;}
  const discriminant=b*b-4*a*c;
  if(discriminant<0)return;
  const q=-.5*(b+(b<0?-1:1)*Math.sqrt(discriminant));
  if(q===0)push(-b/(2*a));else{push(q/a);push(c/q);}
}
/** Visibility changes only at sphere-surface or apparent-limb crossings. Split
 * there, then nearest-ray-test each interval. This catches an occluding body
 * BETWEEN visible endpoints (or away from the segment midpoint), without a
 * screen-space bounding box or unbounded recursive tessellation. */
function segmentRelative(a:Vec3,b:Vec3,c:ProjectionContext,budget=MAX_FRAGMENTS):TrajectoryScreenSegment[] {
  const clipped=clip(a,b,c);if(!clipped)return [];
  [a,b]=clipped;
  const delta=subtract(b,a),boundaries=[0,1],delta2=dot(delta,delta);
  if(!(delta2>0)||!Number.isFinite(delta2))return [];
  const maximumRange=Math.max(length(a),length(b));
  const spheres=c.pathSpheres.filter(s=>length(s.center)-s.radius-s.tolerance<=maximumRange);
  for(const sphere of spheres) {
    const ca=cross(sphere.center,a),cd=cross(sphere.center,delta),r2=sphere.radius*sphere.radius;
    roots(dot(cd,cd)-r2*delta2,2*(dot(ca,cd)-r2*dot(a,delta)),dot(ca,ca)-r2*dot(a,a),boundaries);
    const local=subtract(a,sphere.center);
    roots(delta2,2*dot(local,delta),dot(local,local)-r2,boundaries);
  }
  boundaries.sort((x,y)=>x-y);
  const output:TrajectoryScreenSegment[]=[];
  const project=(p:Vec3):[number,number]|null=>{
    const depth=dot(p,c.basis.forward);if(!(depth>0))return null;
    const x=c.width/2+dot(p,c.basis.right)*c.height/(2*c.tan*depth),y=c.height/2-dot(p,c.basis.up)*c.height/(2*c.tan*depth);
    return Number.isFinite(x+y)?[Math.min(c.width,Math.max(0,x)),Math.min(c.height,Math.max(0,y))]:null;
  };
  for(let i=1;i<boundaries.length&&output.length<budget;i++) {
    const from=boundaries[i-1],to=boundaries[i];if(to-from<=1e-13)continue;
    if(occludedRelative(add(a,scale(delta,(from+to)/2)),spheres))continue;
    const p=project(add(a,scale(delta,from))),q=project(add(a,scale(delta,to)));
    if(p&&q&&Math.hypot(q[0]-p[0],q[1]-p[1])>1e-7)output.push([p[0],p[1],q[0],q[1]]);
  }
  return output;
}
/** Public pure projection helper for independent mathematical/fixture checks. */
export function projectTrajectorySegment(a:Vec3,b:Vec3,snapshot:SpaceSnapshot,camera:SpaceCamera,width:number,height:number):TrajectoryScreenSegment[] {
  const c=context(snapshot,camera,width,height);
  return c&&finite(a)&&finite(b)?segmentRelative(subtract(a,camera.positionAU),subtract(b,camera.positionAU),c):[];
}

/** SVG is a screen projection of finite 3D source vertices, not a GPU pass or a
 * physical spacecraft model. Caller owns the one animation loop, data fetch and
 * current scientific snapshot. There are no timers, global listeners or GL. */
export class TrajectoryOverlay {
  private disposed=false;
  private readonly svg:SVGSVGElement;
  private readonly path:SVGPathElement;
  private readonly clipRect:SVGRectElement;
  private readonly markers=new Map<string,HTMLButtonElement>();
  private selectedRecord:EphemerisTrajectoryRecord|undefined;
  private relativeVertices:Vec3[]=[];
  private onSelect:((missionId:string)=>void)|undefined;
  constructor(private readonly root:HTMLElement,onSelect:(missionId:string)=>void) {
    this.onSelect=onSelect;
    const doc=root.ownerDocument,clipId=`spacecraft-trajectory-clip-${++nextOverlayId}`;
    this.svg=doc.createElementNS(SVG_NS,'svg');this.svg.classList.add('spacecraft-trajectory-svg');
    this.svg.setAttribute('aria-hidden','true');this.svg.setAttribute('focusable','false');
    Object.assign(this.svg.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',overflow:'hidden'});
    const defs=doc.createElementNS(SVG_NS,'defs'),clipPath=doc.createElementNS(SVG_NS,'clipPath');clipPath.id=clipId;clipPath.setAttribute('clipPathUnits','userSpaceOnUse');
    this.clipRect=doc.createElementNS(SVG_NS,'rect');clipPath.append(this.clipRect);defs.append(clipPath);
    this.path=doc.createElementNS(SVG_NS,'path');this.path.classList.add('spacecraft-trajectory-path');
    this.path.setAttribute('fill','none');this.path.setAttribute('stroke','currentColor');this.path.setAttribute('stroke-width','1.25');this.path.setAttribute('vector-effect','non-scaling-stroke');this.path.setAttribute('clip-path',`url(#${clipId})`);
    this.svg.append(defs,this.path);root.append(this.svg);
    root.dataset.trajectoryFrame='current-center-relative';root.dataset.trajectoryFrameNotice=TRAJECTORY_FRAME_NOTICE;
  }
  private marker(state:CraftState):HTMLButtonElement {
    const previous=this.markers.get(state.missionId);if(previous)return previous;
    const button=this.root.ownerDocument.createElement('button');button.type='button';button.className='spacecraft-marker';button.dataset.spacecraftMarker=state.missionId;
    Object.assign(button.style,{position:'absolute',left:'0',top:'0',width:'18px',height:'18px',padding:'0',border:'0',background:'transparent',pointerEvents:'auto'});
    const dot=this.root.ownerDocument.createElement('span');dot.className='spacecraft-marker-dot';dot.setAttribute('aria-hidden','true');
    Object.assign(dot.style,{position:'absolute',left:'5.5px',top:'5.5px',width:'7px',height:'7px',borderRadius:'50%',background:'currentColor'});
    const label=this.root.ownerDocument.createElement('span');label.className='spacecraft-marker-label';
    Object.assign(label.style,{position:'absolute',left:'22px',top:'9px',transform:'translateY(-50%)',whiteSpace:'nowrap'});
    button.append(dot,label);
    const stop=(event:Event)=>event.stopPropagation();
    button.onpointerdown=stop;button.onmousedown=stop;button.ontouchstart=stop;button.onkeydown=stop;button.onkeyup=stop;button.onwheel=stop;
    button.onclick=(event)=>{event.stopPropagation();if(!this.disposed&&!button.hidden&&!this.root.hidden&&this.markers.get(state.missionId)===button)this.onSelect?.(state.missionId);};
    this.markers.set(state.missionId,button);this.root.append(button);return button;
  }
  private clearPath():void {patchAttribute(this.path,'d','');this.setData('trajectorySourceVertices','0');this.setData('trajectoryFragments','0');this.setData('trajectoryTruncated','false');}
  private setData(key:string,value:string):void {if(this.root.dataset[key]!==value)this.root.dataset[key]=value;}
  update(snapshot:SpaceSnapshot,camera:SpaceCamera,states:readonly CraftState[],selected:TrajectoryRecord|undefined,visible:boolean,_now:number):void {
    if(this.disposed)return;
    const view=this.root.ownerDocument.defaultView,width=this.root.clientWidth||view?.innerWidth||0,height=this.root.clientHeight||view?.innerHeight||0;
    const c=visible?context(snapshot,camera,width,height):null;
    patchHidden(this.root,!c);
    if(!c){for(const button of this.markers.values())patchHidden(button,true);this.clearPath();return;}
    patchAttribute(this.svg,'viewBox',`0 0 ${width} ${height}`);patchAttribute(this.clipRect,'width',String(width));patchAttribute(this.clipRect,'height',String(height));
    const epoch=snapshot.date.getTime(),seen=new Set<string>();
    for(const state of states) {
      if(seen.size>=MAX_TRAJECTORY_RECORDS)break;
      if(!TRAJECTORY_MISSION_IDS.includes(state.missionId)||seen.has(state.missionId)||state.epochMs!==epoch||!finite(state.positionAU))continue;
      seen.add(state.missionId);
      const button=this.marker(state),p=projectSpace(state.positionAU,camera,width,height);
      patchHidden(button,!p.visible||occludedRelative(subtract(state.positionAU,camera.positionAU),c.spheres));
      for(const [key,value]of [['sourceKind',state.kind],['sourceQuality',state.quality],['epochMs',String(epoch)],['selected',String(selected?.missionId===state.missionId)]])if(button.dataset[key]!==value)button.dataset[key]=value;
      patchAttribute(button,'aria-pressed',button.dataset.selected!);
      const provenance=state.kind==='surface-site'?'历史着陆点；不是当前巡视器位置':`${state.quality}；源星历插值；非实时遥测`;
      patchAttribute(button,'aria-label',`${state.name}；${provenance}；固定像素符号，非航天器物理大小`);
      patchAttribute(button,'title',button.getAttribute('aria-label')!);patchText(button.lastElementChild!,state.name);
      if(!button.hidden){const transform=`translate(${p.x-9}px,${p.y-9}px)`;if(button.style.transform!==transform)button.style.transform=transform;}
    }
    for(const [id,button]of this.markers)if(!seen.has(id))patchHidden(button,true);
    if(selected?.kind!=='ephemeris'||!seen.has(selected.missionId)||!sampleTrajectory(selected,epoch,snapshot)) {
      this.selectedRecord=undefined;this.relativeVertices=[];this.clearPath();return;
    }
    if(this.selectedRecord!==selected) {
      this.selectedRecord=selected;
      // Cache ONLY relative doubles; rebasing remains same-frame as the bodies.
      this.relativeVertices=selected.samples.slice(0,MAX_TRAJECTORY_SAMPLES).map(s=>[s[1],s[2],s[3]]);
    }
    const center=selected.centerBodyId==='sun'?[0,0,0] as Vec3:snapshot.bodies.find(b=>b.id===selected.centerBodyId)?.positionAU;
    if(!center||!finite(center)){this.clearPath();return;}
    const origin=subtract(center,camera.positionAU),commands:string[]=[];
    let count=0,truncated=false;
    const fmt=(value:number)=>String(Math.round(value*1e6)/1e6);
    this.setData('trajectorySourceVertices',String(this.relativeVertices.length));
    for(let i=1;i<this.relativeVertices.length;i++) {
      const a=this.relativeVertices[i-1],b=this.relativeVertices[i],seconds=(selected.samples[i][0]-selected.samples[i-1][0])/1000;
      if(!finite(a)||!finite(b)||!(seconds>0)||seconds>selected.maxGapSeconds+1e-9)continue;
      const segments=segmentRelative(add(origin,a),add(origin,b),c,MAX_FRAGMENTS-count);
      for(const [x,y,x2,y2] of segments){commands.push(`M${fmt(x)},${fmt(y)}L${fmt(x2)},${fmt(y2)}`);count++;}
      if(count>=MAX_FRAGMENTS){truncated=true;break;}
    }
    patchAttribute(this.path,'d',commands.join(''));
    this.setData('trajectoryFragments',String(count));this.setData('trajectoryTruncated',String(truncated));
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;this.onSelect=undefined;
    for(const button of this.markers.values()) {
      button.onclick=null;button.onpointerdown=null;button.onmousedown=null;button.ontouchstart=null;button.onkeydown=null;button.onkeyup=null;button.onwheel=null;button.remove();
    }
    this.markers.clear();this.selectedRecord=undefined;this.relativeVertices=[];this.svg.remove();
    for(const key of ['trajectoryFrame','trajectoryFrameNotice','trajectorySourceVertices','trajectoryFragments','trajectoryTruncated'])delete this.root.dataset[key];
  }
}
