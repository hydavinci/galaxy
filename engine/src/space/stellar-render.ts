import { bodyFrame, RAD, validCamera, type BodyFrame } from './render-math';
import { getStellarModel, stellarBody, type StellarModel } from './stellar-model';
import { AU_KM, type CatalogStar3D, type SpaceBody, type SpaceCamera } from './types';

/** Original unresolved PSF is at most 10 CSS pixels; never inflate physical radii. */
export const STELLAR_RESOLVED_DIAMETER = 10;
export const STELLAR_SURFACE_DIAMETER = 20;
export const MAX_STELLAR_SPHERES = 16;
export interface StellarFrame extends BodyFrame {
  star:CatalogStar3D;
  model:StellarModel;
  /** Same catalog position has one deterministic visual representative, not a fabricated binary orbit. */
  pointIds:readonly string[];
}
interface Prepared {
  star:CatalogStar3D; model:StellarModel; body:SpaceBody; radiusAU:number; pointIds:readonly string[];
}
interface Node {
  min:[number,number,number]; max:[number,number,number]; radius:number;
  left?:Node; right?:Node; records?:Prepared[];
}
const zero:[number,number,number]=[0,0,0];
const positionKey=(star:CatalogStar3D)=>star.positionAU.join('/');
function tree(records:Prepared[]):Node|undefined {
  if(!records.length)return undefined;
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];let radius=0;
  for(const r of records){radius=Math.max(radius,r.radiusAU);for(let k=0;k<3;k++){min[k]=Math.min(min[k],r.star.positionAU[k]);max[k]=Math.max(max[k],r.star.positionAU[k]);}}
  const node:Node={min,max,radius};
  if(records.length<=12){node.records=records;return node;}
  let axis=0;for(let k=1;k<3;k++)if(max[k]-min[k]>max[axis]-min[axis])axis=k;
  records.sort((a,b)=>a.star.positionAU[axis]-b.star.positionAU[axis]||a.star.id.localeCompare(b.star.id));
  const half=records.length>>>1;node.left=tree(records.slice(0,half));node.right=tree(records.slice(half));return node;
}
/** One prepared spatial index, zero model construction in animation frames.
 * AABB/max-radius pruning visits only potentially resolved neighbors. View cache
 * includes orientation/roll/FOV, viewport and selected ID, not merely translation.
 * This planner returns drawable spheres only; overflow stays in the old PSF pass.
 */
export class StellarFramePlanner {
  private root?:Node;
  private byId=new Map<string,Prepared>();
  private frames:readonly StellarFrame[]=[];
  private key='';
  private disposed=false;
  readonly stats={prepared:0,rebuilds:0,visitedNodes:0,testedStars:0,projected:0};
  constructor(stars:readonly CatalogStar3D[]) {
    const groups=new Map<string,string[]>();
    for(const star of stars){const key=positionKey(star),group=groups.get(key);if(group)group.push(star.id);else groups.set(key,[star.id]);}
    const records:Prepared[]=[];
    for(const star of stars){
      const model=getStellarModel(star),body=model?stellarBody(star):null,radiusAU=(body?.radiusKm??0)/AU_KM;
      if(!model||!body||!(radiusAU>0)||!Number.isFinite(radiusAU)||!Number.isFinite(model.temperatureK)||model.temperatureK<=0||!Number.isFinite(model.seed)||!model.color.every(c=>Number.isFinite(c)&&c>=0&&c<=1))continue;
      const record={star,model,body,radiusAU,pointIds:groups.get(positionKey(star))!};records.push(record);this.byId.set(star.id,record);
    }
    this.stats.prepared=records.length;this.root=tree(records);
  }
  plan(camera:SpaceCamera,width:number,height:number,selectedId:string|null):readonly StellarFrame[] {
    if(this.disposed||!validCamera(camera)||!(width>0&&height>0)||!Number.isFinite(width+height))return [];
    const key=`${camera.positionAU.join('/')}/${camera.azimuthDeg}/${camera.altitudeDeg}/${camera.rollDeg??0}/${camera.fovDeg}/${width}/${height}/${selectedId}`;
    if(key===this.key)return this.frames;
    this.key=key;this.stats.rebuilds++;this.stats.visitedNodes=0;this.stats.testedStars=0;this.stats.projected=0;
    const focal=height/(2*Math.tan(camera.fovDeg*RAD/2)),r=STELLAR_RESOLVED_DIAMETER/2;
    const minRatio=r/Math.hypot(focal,r),selected=selectedId?this.byId.get(selectedId):undefined;
    const ranked:StellarFrame[]=[],represented=new Map<readonly string[],StellarFrame>();
    const precedes=(a:StellarFrame,b:StellarFrame)=>a.star.id===selectedId?true:b.star.id===selectedId?false:
      a.radiusCssPixels!==b.radiusCssPixels?a.radiusCssPixels>b.radiusCssPixels:a.star.id.localeCompare(b.star.id)<0;
    const offer=(record:Prepared)=>{
      this.stats.testedStars++;
      const p=record.star.positionAU,d=Math.hypot(p[0]-camera.positionAU[0],p[1]-camera.positionAU[1],p[2]-camera.positionAU[2]);
      if(!(d>record.radiusAU)||record.radiusAU/d<minRatio)return;
      this.stats.projected++;
      const f=bodyFrame(record.body,zero,camera,width,height,false);if(!f||f.radiusCssPixels*2<STELLAR_RESOLVED_DIAMETER)return;
      const frame:StellarFrame={...f,star:record.star,model:record.model,pointIds:record.pointIds};
      const old=represented.get(record.pointIds);
      // At a coincident catalog location selected wins, otherwise lexical ID.
      // It is a display choice, never a measured separation or merged star model.
      if(old){if(old.star.id===selectedId||frame.star.id!==selectedId&&old.star.id.localeCompare(frame.star.id)<0)return;
        ranked.splice(ranked.indexOf(old),1);represented.delete(record.pointIds);}
      let i=0;while(i<ranked.length&&!precedes(frame,ranked[i]))i++;
      if(i<MAX_STELLAR_SPHERES){ranked.splice(i,0,frame);represented.set(record.pointIds,frame);
        if(ranked.length>MAX_STELLAR_SPHERES){const dropped=ranked.pop()!;represented.delete(dropped.pointIds);}}
    };
    if(selected)offer(selected);
    const visit=(node:Node|undefined)=>{
      if(!node)return;this.stats.visitedNodes++;
      let d2=0;for(let k=0;k<3;k++){const x=camera.positionAU[k],gap=Math.max(0,node.min[k]-x,x-node.max[k]);d2+=gap*gap;}
      if(d2>(node.radius/minRatio)**2)return;
      if(node.records){for(const record of node.records)if(record!==selected)offer(record);}
      else {visit(node.left);visit(node.right);}
    };
    visit(this.root);this.frames=ranked;return this.frames;
  }
  dispose(){this.disposed=true;this.root=undefined;this.byId.clear();this.frames=[];this.key='';}
}
