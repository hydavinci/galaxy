import { bodyFrame, bodyHitDistance, spaceCameraBasis, starMagnitude, type BodyFrame } from './render-math';
import type { CatalogStar3D, SpaceCamera, SpaceProjection, SpaceSnapshot, Vec3 } from './types';
import { focusSizeCssPixels } from './focus';
import { getStellarModel } from './stellar-model';

export const STAR_LABEL_REFRESH_MS = 150;
export const STAR_LABEL_MAX = 48;
export const starLabelBudget = (width:number) => width <= 700 ? 24 : STAR_LABEL_MAX;
export interface LabelRect { x:number; y:number; width:number; height:number; }
interface NameRecord { star:CatalogStar3D; text:string; units:number; proper:boolean; }
export interface StarLabelPlacement extends LabelRect { id:string; text:string; selected:boolean; anchor:SpaceProjection; }
export interface LabelFrame {
  camera:SpaceCamera; snapshot:SpaceSnapshot; width:number; height:number; now:number;
  selectedId:string|null; enabled:boolean; bodyLabels:LabelRect[]; obstacles:LabelRect[];
  stellarFrames?:readonly BodyFrame[];
  /** Stabilize placement priority during an actual view gesture, not projection. */
  interacting?:boolean;
}
/** Conservative fixed button boxes: no font/layout reads in the moving overlay.
 * Latin names use >= .75em/glyph; CJK and wide Latin get a larger allowance.
 * CSS fixes line-height/padding and the assigned width, so collision boxes are exact. */
export function nameUnits(text:string):number {
  return Array.from(text).reduce((n,c)=>n+(c.codePointAt(0)!>255?1.1:'MW@#%&'.includes(c)?1:.75),0);
}
export function labelNameWidth(units:number,width:number):number {
  return Math.min(Math.max(22,Math.ceil(units*(width<=700?9:10)+12)),Math.max(22,width-16));
}
export function overlaps(a:LabelRect,b:LabelRect,gap=3):boolean {
  return a.x < b.x+b.width+gap && a.x+a.width+gap > b.x && a.y < b.y+b.height+gap && a.y+a.height+gap > b.y;
}
/** Prepared, roll-aware pinhole projection. Subtraction stays in double precision;
 * share the renderer's screen basis, not a second Euler/up-vector interpretation. */
export function labelProjector(camera:SpaceCamera,width:number,height:number):(position:Vec3)=>SpaceProjection {
  const {right,up,forward}=spaceCameraBasis(camera),focal=height/(2*Math.tan(camera.fovDeg*Math.PI/360));
  return position=>{
    const x=position[0]-camera.positionAU[0],y=position[1]-camera.positionAU[1],z=position[2]-camera.positionAU[2];
    const distanceAU=Math.hypot(x,y,z),depth=x*forward[0]+y*forward[1]+z*forward[2];
    if(!(width>0&&height>0&&distanceAU>0&&depth/distanceAU>1e-15))return {x:-1,y:-1,visible:false,distanceAU};
    const px=width/2+(x*right[0]+y*right[1]+z*right[2])/depth*focal,py=height/2-(x*up[0]+y*up[1]+z*up[2])/depth*focal;
    return {x:px,y:py,visible:Number.isFinite(px+py)&&px>=0&&px<=width&&py>=0&&py<=height,distanceAU};
  };
}
/** Use the renderer's circular physical globe, including off-axis closeups.
 * A generic ray/sphere test would disagree with this app's local optical window.
 * Translucent halos/rings are deliberately NOT treated as opaque planetary disks. */
function occulted(p:SpaceProjection,frames:BodyFrame[],f:LabelFrame,id:string):boolean {
  return frames.some(b=>{if(b.body.id===id)return false;const hit=bodyHitDistance(b,p.x,p.y,f.width,f.height,f.camera);return hit!==null&&hit<p.distanceAU;});
}
function paintsNearerDisk(rect:LabelRect,distanceAU:number,frames:BodyFrame[],f:LabelFrame):boolean {
  return frames.some(b=>{
    if(b.distanceAU-b.radiusAU>=distanceAU)return false;
    const x=(b.centerNdc[0]+1)*f.width/2,y=(1-b.centerNdc[1])*f.height/2;
    const dx=x-Math.max(rect.x,Math.min(x,rect.x+rect.width)),dy=y-Math.max(rect.y,Math.min(y,rect.y+rect.height));
    return dx*dx+dy*dy <= (b.radiusCssPixels+2)**2;
  });
}

/** Full immutable metadata, small mutable candidate set. No full-catalog sort or
 * scan on animation frames between refreshes; selected ID bypasses all ranking. */
export class StellarLabelPlanner {
  private records:NameRecord[];
  private byId:Map<string,NameRecord>;
  private candidates:NameRecord[]=[];
  private lastRefresh=-Infinity;
  private lastPriorityRefresh=-Infinity;
  private lastKey='';
  private lastCameraKey='';
  private rankingDirty=true;
  // Only the previous frame's accepted labels own slots (<=48). Remember a
  // side, never screen coordinates: projection and all rejection tests run now.
  private incumbents=new Map<string,number>();
  readonly stats={rebuilds:0,scanned:0,candidates:0,projected:0,reranked:0};
  constructor(stars:CatalogStar3D[]) {
    this.records=stars.map(star=>{const text=star.nameZh||star.name||star.id;return {star,text,units:nameUnits(text),proper:!!star.nameZh||!/^(?:HIP|HYG|Gl(?:iese)?)\s*[-\d]/i.test(text)};});
    this.byId=new Map(this.records.map(r=>[r.star.id,r]));
  }
  invalidate(){this.lastRefresh=-Infinity;this.rankingDirty=true;}
  plan(f:LabelFrame):StarLabelPlacement[] {
    const key=`${f.width}/${f.height}/${f.selectedId}/${f.enabled}`;
    if(key!==this.lastKey){this.invalidate();this.lastKey=key;}
    this.stats.projected=0;
    if(!f.enabled||!(f.width>0&&f.height>0)){this.incumbents.clear();return [];}
    const project=labelProjector(f.camera,f.width,f.height),budget=starLabelBudget(f.width);
    const c=f.camera,cameraKey=`${c.positionAU.join('/')}/${c.azimuthDeg}/${c.altitudeDeg}/${c.rollDeg??0}/${c.fovDeg}`;
    if(cameraKey!==this.lastCameraKey){this.rankingDirty=true;this.lastCameraKey=cameraKey;}
    // Immutable catalog membership cannot change merely because time passed.
    // Still evaluate its current anchors/disks every frame, including while the
    // camera is stationary and a moving planet occults a star.
    const refreshed=this.rankingDirty&&f.now-this.lastRefresh>=STAR_LABEL_REFRESH_MS;
    if(refreshed){
      // Bounded binary insertion (<=144 records), not a sort of all 9,078 stars.
      // Brightness is apparent FROM THIS CAMERA, never Solar absolute ranking.
      const ranked:Array<{record:NameRecord;score:number}>=[],limit=budget*3;
      for(const record of this.records){
        if(record.star.id===f.selectedId)continue;
        const p=project(record.star.positionAU);if(!p.visible)continue;
        const mag=starMagnitude(record.star,p.distanceAU);if(!Number.isFinite(mag)||mag>8.7)continue;
        // Small bounded admission hysteresis for currently displayed names.
        // Eligibility still uses CURRENT magnitude/visibility above; a newcomer
        // >0.35 mag better may replace an incumbent at the candidate boundary.
        const score=mag-(record.proper?.75:0)-(this.incumbents.has(record.star.id)?.35:0);
        let lo=0,hi=ranked.length;
        while(lo<hi){const mid=(lo+hi)>>>1;if(score<ranked[mid].score)hi=mid;else lo=mid+1;}
        if(lo<limit){ranked.splice(lo,0,{record,score});if(ranked.length>limit)ranked.pop();}
      }
      this.candidates=ranked.map(r=>r.record);this.lastRefresh=f.now;this.rankingDirty=false;
      this.stats.rebuilds++;this.stats.scanned+=this.records.length;this.stats.candidates=this.candidates.length;
    }
    const priorityRefresh=refreshed||f.now-this.lastPriorityRefresh>=STAR_LABEL_REFRESH_MS;
    if(priorityRefresh){
      if(!refreshed){
        // Even a stationary camera can see a bright candidate emerge from a
        // moving planet. Reconsider only the bounded reserve set, not all stars,
        // so incumbent priority cannot persist indefinitely after occultation.
        this.candidates=this.candidates.map(record=>({record,score:starMagnitude(record.star,project(record.star.positionAU).distanceAU)-(record.proper?.75:0)-(this.incumbents.has(record.star.id)?.35:0)})).sort((a,b)=>a.score-b.score).map(entry=>entry.record);
        this.stats.reranked+=this.candidates.length;
      }
      this.lastPriorityRefresh=f.now;
    }
    const sun=f.snapshot.bodies.find(b=>b.id==='sun')?.positionAU??[0,0,0] as Vec3;
    const frames=[...f.snapshot.bodies.map(b=>bodyFrame(b,sun,f.camera,f.width,f.height,false)).filter((b):b is BodyFrame=>!!b&&b.radiusCssPixels*2>=1.4),...(f.stellarFrames??[])];
    const placed:StarLabelPlacement[]=[],occupied=[...f.obstacles,...f.bodyLabels],nextIncumbents=new Map<string,number>();
    const selected=f.selectedId?this.byId.get(f.selectedId):undefined;
    const place=(record:NameRecord,isSelected:boolean)=>{
      this.stats.projected++;
      const p=project(record.star.positionAU);
      if(!p.visible||(!isSelected&&starMagnitude(record.star,p.distanceAU)>8.7)||occulted(p,frames,f,record.star.id))return;
      // Selected names start outside the existing hollow locator, not through
      // its right/left tick. This is UI clearance, never an invented star radius.
      const w=labelNameWidth(record.units,f.width),h=22;
      const model=getStellarModel(record.star),surface=frames.find(b=>b.body.id===record.star.id);
      const gap=isSelected?focusSizeCssPixels(model?.radiusKm??null,p.distanceAU,f.camera.fovDeg,f.width,f.height)/2+4:Math.max(8,(surface?.radiusCssPixels??0)+8);
      // Keep each label attached to its star. Try the opposite side at an edge;
      // never clamp an offscreen/occulted star into a fake screen position.
      const offsets=[[gap,-h/2],[-w-gap,-h/2],[-w/2,-h-gap],[-w/2,gap],
        [gap,-h-gap],[-w-gap,-h-gap],[gap,gap],[-w-gap,gap]];
      const previous=this.incumbents.get(record.star.id);
      // Keep a still-valid side rather than bouncing back to the preferred
      // right slot as a nearby collision/edge threshold is crossed in a drag.
      for(let attempt=0;attempt<offsets.length;attempt++){
        const slot=previous===undefined?attempt:attempt===0?previous:attempt<=previous?attempt-1:attempt;
        const [dx,dy]=offsets[slot],rect={x:p.x+dx,y:p.y+dy,width:w,height:h};
        if(rect.x<4||rect.y<4||rect.x+w>f.width-4||rect.y+h>f.height-4)continue;
        if(occupied.some(o=>overlaps(rect,o))||paintsNearerDisk(rect,p.distanceAU,frames,f))continue;
        const label={...rect,id:record.star.id,text:record.text,selected:isSelected,anchor:p};
        placed.push(label);occupied.push(rect);nextIncumbents.set(record.star.id,slot);return;
      }
    };
    if(selected)place(selected,true);
    // Between ranking refreshes keep current incumbents ahead of reserves.
    // On refresh use the current apparent scores (+bounded 0.35 mag hysteresis)
    // so a genuinely brighter newcomer does not wait behind stale priority.
    // Never retain an offscreen/occulted/faint label or a previous rectangle.
    const eligible=new Map(this.candidates.map(record=>[record.star.id,record]));
    // A periodic magnitude refresh must not reorder two still-valid moving
    // labels under the pointer. Reserves fill vacancies; release restores normal
    // priorities. Anchors, visibility and occultation are always checked now.
    if(!priorityRefresh||f.interacting)for(const id of this.incumbents.keys()){
      if(placed.length>=budget)break;
      const record=eligible.get(id);if(record){place(record,false);eligible.delete(id);}
    }
    for(const record of eligible.values()){if(placed.length>=budget)break;place(record,false);}
    this.incumbents=nextIncumbents;
    return placed;
  }
  dispose(){this.records=[];this.byId.clear();this.candidates=[];this.incumbents.clear();}
}

/** Bounded, stable-ID DOM pool. UI measurements are read as a batch BEFORE app
 * overlay writes; zero-sized rectangles in a test DOM deterministically reserve
 * nothing. Text sizing never measures 9,078 nodes (they do not exist). */
export class StarLabels {
  readonly planner:StellarLabelPlanner;
  private pool:HTMLButtonElement[]=[];
  private ui:HTMLElement[];
  private obstacles:LabelRect[]=[];
  private measuredAt=-Infinity;
  private size='';
  private hiddenKey='';
  private written=new WeakMap<HTMLButtonElement,{width?:number;x?:number;y?:number;selected?:boolean}>();
  constructor(private root:HTMLElement,stars:CatalogStar3D[],private select:(id:string)=>void){
    this.planner=new StellarLabelPlanner(stars);
    this.ui=Array.from(root.ownerDocument.querySelectorAll<HTMLElement>('.brand,.search-wrap,.top-actions,.journey-heading,#space-object,#space-craft-panel,.view-tools,.bottom-area,.move-pad,.speed-control,#space-results,#space-toast'));
  }
  invalidateLayout(){this.measuredAt=-Infinity;}
  readObstacles(now:number,width:number,height:number):LabelRect[]{
    const size=`${width}/${height}`,hiddenKey=this.ui.map(node=>Number(node.hidden)).join('');
    // A panel opening/closing must not wait for the periodic fallback. Viewport
    // size is also checked here even if a resize event was coalesced/missed.
    if(size!==this.size||hiddenKey!==this.hiddenKey||now-this.measuredAt>=STAR_LABEL_REFRESH_MS){
      this.obstacles=[];
      for(const node of this.ui){if(node.hidden)continue;const r=node.getBoundingClientRect();if(r.width>0&&r.height>0)this.obstacles.push({x:r.left,y:r.top,width:r.width,height:r.height});}
      this.measuredAt=now;this.size=size;this.hiddenKey=hiddenKey;
    }
    return this.obstacles;
  }
  update(frame:LabelFrame){
    const placements=this.planner.plan(frame),wanted=new Set(placements.map(p=>p.id));
    // Do not silently change the identity of a button held by assistive/script
    // focus. At the hard cap an ordinary label may wait until focus moves.
    const available=this.pool.filter(b=>!wanted.has(b.dataset.target!)&&b!==this.root.ownerDocument.activeElement);
    const assigned=new Map(this.pool.filter(b=>wanted.has(b.dataset.target!)).map(b=>[b.dataset.target!,b]));
    for(const p of placements){
      if(!wanted.has(p.id))continue;
      let b=assigned.get(p.id);
      if(!b){
        b=available.pop();
        if(!b&&this.pool.length>=STAR_LABEL_MAX&&p.selected){
          b=this.pool.find(node=>node!==this.root.ownerDocument.activeElement);
          if(b){const old=b.dataset.target!;wanted.delete(old);assigned.delete(old);}
        }
        if(!b&&this.pool.length>=STAR_LABEL_MAX)continue;
        if(!b){b=this.root.ownerDocument.createElement('button');b.type='button';b.className='space-label space-star-label';b.tabIndex=-1;b.hidden=true;b.dataset.kind='catalog-star';this.written.set(b,{});
          b.onclick=event=>{event.stopPropagation();const id=(event.currentTarget as HTMLButtonElement).dataset.target;if(id)this.select(id);};
          b.onpointerdown=event=>event.stopPropagation();this.root.appendChild(b);this.pool.push(b);}
        b.dataset.target=p.id;
        if(b.textContent!==p.text)b.textContent=p.text;
        const title=`${p.text} · 目录恒星`,aria=`${p.text}，目录恒星，选择并查看信息`;
        if(b.title!==title)b.title=title;if(b.getAttribute('aria-label')!==aria)b.setAttribute('aria-label',aria);
      }
      if(b.hidden)b.hidden=false;
      const written=this.written.get(b)!;
      if(written.selected!==p.selected){b.dataset.selected=String(p.selected);written.selected=p.selected;}
      if(written.width!==p.width){b.style.width=`${p.width}px`;written.width=p.width;}
      if(written.x!==p.x||written.y!==p.y){b.style.transform=`translate(${p.x}px,${p.y}px)`;written.x=p.x;written.y=p.y;}
    }
    for(const b of this.pool)if(!wanted.has(b.dataset.target!)&&!b.hidden)b.hidden=true;
  }
  dispose(){for(const b of this.pool){b.onclick=null;b.onpointerdown=null;b.remove();}this.pool=[];this.ui=[];this.obstacles=[];this.planner.dispose();}
}
