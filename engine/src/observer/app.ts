import { lifetimeFetch, disposeRenderer } from '../modes/lifecycle';
import { allSkySettings, bodyInspectionFov } from './allsky';
import { loadNamedCatalog } from './catalog-names';
import { computeSky, DEFAULT_LOCATION, starHorizontal, validateLocation } from './astronomy';
import { SkyRenderer, apparentDirection, bodyDiskContains, equatorialDirection, projectDirection, transformDirection } from './sky-renderer';
import { formatFov } from './zoom';
import { inspectionRingFov } from './saturn-rings';
import { EarthInspector } from './earth-inspector';
import { CONSTELLATIONS } from '../data/constellations';
import { ObservationClock, ViewController, nextSpeed, speedText, STAR_NAMES, BODY_NAMES, CONSTELLATION_NAMES, compass, phaseName, clamp } from './controls';
import type { CatalogStar, ObserverLocation, ProjectedPoint, SkyBody, SkySettings, SkyState, Vec3 } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { const el=$(id); if(el.textContent!==value)el.textContent=value; };
const button = (label: string, action: () => void, className = '') => { const b=document.createElement('button');b.type='button';b.textContent=label;b.className=className;b.addEventListener('click',action);return b; };
type Target = { kind:'body'; id:string } | {kind:'star'; id:string} | {kind:'constellation';id:string};
type SearchTarget = Target | { kind:'inspector'; id:'earth' };
interface SearchItem { target:SearchTarget; name:string; english:string; subtitle:string; }
interface OverlayRect { x:number; y:number; w:number; h:number; }
interface OverlayLabel {
  target:Target; el:HTMLElement; raRad:number; decRad:number; magnitude:number; width:number;
  body?:SkyBody; direction?:Vec3; directionState?:SkyState;
}
// Compose optical anchoring after screen translation: labels keep their 7px
// offset; constellation names and the circular marker stay centered. No DPR
// multiplication or rounding: projection and DOM both use CSS pixels.
const overlayTransforms=new WeakMap<HTMLElement,string>();
function placeOverlay(el:HTMLElement,p:ProjectedPoint,centered=false) {
  const transform=`translate(${p.x}px,${p.y}px) translate(${centered?'-50%':'7px'},-50%)`;
  // Cache our value instead of comparing CSSOM serialization (browsers may
  // normalize whitespace/precision and would otherwise rewrite a still label).
  if(overlayTransforms.get(el)!==transform){el.style.transform=transform;overlayTransforms.set(el,transform);}
  if(el.hidden)el.hidden=false;
}
const STORAGE='galaxy-allsky-v2';
const LEGACY_STORAGE='galaxy-observer-preview-v1';
const DEFAULT_SETTINGS: SkySettings = {atmosphere:false,ground:false,constellations:false,grid:false,labels:true,milkyWay:true,refraction:false,lightPollution:4,mode:'visual'};

export class ObserverApp {
  private renderer: SkyRenderer;
  private canvas=$<HTMLCanvasElement>('sky');
  private clock = new ObservationClock();
  private view = new ViewController();
  private location:ObserverLocation={...DEFAULT_LOCATION};
  private settings:SkySettings={...DEFAULT_SETTINGS};
  private state!:SkyState;
  private stars:CatalogStar[]=[];
  private selected:Target|null=null;
  private tracking=false;
  private namedLabels=new Map<string,HTMLButtonElement>();
  private cardinals:HTMLElement[]=[];
  private overlayLabels=new Map<string,OverlayLabel>();
  private overlayStars:OverlayLabel[]=[];
  private overlayBodies:OverlayLabel[]=[];
  private overlayConstellations:OverlayLabel[]=[];
  private constellationCenters=new Map<string,{raRad:number;decRad:number}>();
  private overlayCandidates:OverlayLabel[]=[];
  private activeOverlays:OverlayLabel[]=[];
  private visibleOverlays=new Set<OverlayLabel>();
  private overlayState:SkyState|null=null;
  private overlayObstacles:OverlayRect[]=[];
  private overlayObstacleElements:HTMLElement[]=[];
  private overlayObstaclesDirty=true;
  private overlayWidth=0;
  private overlayHeight=0;
  private markerSize='';
  private constellationLabels=new Map<string,HTMLElement>();
  private lastFrame=performance.now();
  private lastCompute=-Infinity;
  private lastUI=-Infinity;
  private lastLabels=-Infinity;
  private dirty=true;
  private animation=0;
  private toastTimer=0;
  private searchItems:SearchItem[]=[];
  private points=new Map<number,{x:number;y:number}>();
  // Pointer presence suppresses inertia, not tracking. Only a deliberate
  // single-contact pan releases a tracked target; a pinch/hold must follow it.
  private panAnchor:{x:number;y:number}|null=null;
  private panActive=false;
  private suppressClick=false;
  private lastPointerTime=0;
  private initialPinch=0;
  private immersive=false;
  private namesWarning:string|null=null;
  private earthInspector:EarthInspector|null=null;
  private disposed=false;
  private loadAbort=new AbortController();
  private cleanups:Array<()=>void>=[];
  private resizeObserver?:ResizeObserver;
  private debug:unknown;
  get isDisposed(){return this.disposed;}
  private listen<K extends keyof (WindowEventMap & DocumentEventMap & HTMLElementEventMap & {webglcontextlost:Event})>(target:EventTarget,name:K,fn:(event:(WindowEventMap & DocumentEventMap & HTMLElementEventMap & {webglcontextlost:Event})[K])=>void,options?:AddEventListenerOptions){
    const listener=fn as EventListener;target.addEventListener(name,listener,options);this.cleanups.push(()=>target.removeEventListener(name,listener,options));
  }
  constructor(signal?:AbortSignal) {
    this.restore();
    this.settings=allSkySettings(this.settings);
    this.save();
    this.renderer=new SkyRenderer(this.canvas);
    try{
    this.view.reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.bindUI();this.bindInput();
    this.overlayObstacleElements=Array.from(document.querySelectorAll<HTMLElement>('.topbar,.object-panel,.toolbar'));
    const resized=()=>this.invalidateOverlayLayout();
    this.listen(window,'resize',resized);
    // Includes responsive panels, font/content changes and canvas resizing.
    // No observer ever reads layout or moves a label outside the render RAF.
    if(typeof ResizeObserver!=='undefined'){
      const observer=this.resizeObserver=new ResizeObserver(resized);
      for(const el of [this.canvas,...this.overlayObstacleElements])observer.observe(el);
    }
    this.listen(this.canvas,'webglcontextlost',(e)=>{e.preventDefault();cancelAnimationFrame(this.animation);this.fail(new Error('图形上下文已中断。请重新载入以恢复天空。'));});
    this.listen(document,'visibilitychange',()=>{this.lastFrame=performance.now();this.dirty=true;});
    this.listen(window,'pagehide',()=>this.dispose());
    if(signal){const abort=()=>this.dispose();signal.addEventListener('abort',abort,{once:true});this.cleanups.push(()=>signal.removeEventListener('abort',abort));if(signal.aborted)this.dispose();}
    }catch(error){this.dispose();throw error;}
  }
  async init() {
    if(this.disposed)return;
    const [named] = await Promise.all([loadNamedCatalog(lifetimeFetch(this.loadAbort.signal)),this.renderer.init()]);
    if(this.disposed)return;
    this.namesWarning=named.warning;
    this.stars=named.data.map((s,i)=>({id:`star-${i}`,name:s.name,nameZh:STAR_NAMES[s.name],raRad:s.ra,decRad:s.dec,magnitude:s.mag,bv:s.bv}));
    this.buildLabels();
    this.state=computeSky(new Date(this.clock.timestamp),this.location);
    this.updateUI();
    $('loading').hidden=true;
    document.body.dataset.ready='true';
    if(this.namesWarning)this.toast(this.namesWarning);
    const self=this;
    (window as any).__galaxy=this.debug={
      get state(){return self.state},get camera(){return {...self.view.camera}},get settings(){return {...self.settings}},get selected(){return self.selected},get stats(){return self.renderer.getStats()},get speed(){return self.clock.speed},
      setDate:(iso:string)=>{self.clock.setDate(new Date(iso));self.dirty=true;},select:(id:string)=>id==='earth'?self.openEarth($('planets-open')):self.select({kind:'body',id},true),
      get catalogStars(){return self.stars.length},dispose:()=>self.dispose()
    };
    this.lastFrame=performance.now();this.animation=requestAnimationFrame(this.loop);
  }
  private restore(){try{const s=JSON.parse(localStorage.getItem(STORAGE)||localStorage.getItem(LEGACY_STORAGE)||'null');if(!s)return;if(s.location){validateLocation(s.location);this.location=s.location;}if(s.settings){for(const k of ['constellations','grid','labels','milkyWay'] as const)if(typeof s.settings[k]==='boolean')this.settings[k]=s.settings[k];if(['visual','enhanced'].includes(s.settings.mode))this.settings.mode=s.settings.mode;if(Number.isFinite(s.settings.lightPollution))this.settings.lightPollution=clamp(Math.round(s.settings.lightPollution),1,9);}}catch{ /* Ignore invalid local preferences; never stop the sky. */ }}
  private save(){try{localStorage.setItem(STORAGE,JSON.stringify({location:this.location,settings:this.settings}));}catch{}}
  private toast(message:string){text('toast',message);$('toast').hidden=false;clearTimeout(this.toastTimer);this.toastTimer=window.setTimeout(()=>$('toast').hidden=true,4500);}
  private setTracking(v:boolean){this.tracking=v;$('object-track').setAttribute('aria-pressed',String(v));text('object-track',v?'跟踪中':'跟踪');}
  private invalidate(){this.dirty=true;this.lastUI=-Infinity;this.lastLabels=-Infinity;}
  private invalidateOverlayLayout(){this.overlayObstaclesDirty=true;this.lastLabels=-Infinity;}
  private bindUI(){
    $('settings-open').onclick=()=>$<HTMLDialogElement>('settings-dialog').showModal();
    $('planets-open').onclick=()=>{this.populatePlanets();$<HTMLDialogElement>('planets-dialog').showModal();};
    $('about-open').onclick=()=>$<HTMLDialogElement>('about-dialog').showModal();
    document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog')?.close());
    document.querySelectorAll<HTMLDialogElement>('dialog:not(#earth-dialog)').forEach(d=>this.listen(d,'click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
    document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b=>{const k=b.dataset.toggle as keyof SkySettings;b.setAttribute('aria-pressed',String(this.settings[k]));b.onclick=()=>{(this.settings as any)[k]=!this.settings[k];b.setAttribute('aria-pressed',String(this.settings[k]));this.save();this.invalidate();};});
    const mode=$<HTMLSelectElement>('sky-mode');mode.value=this.settings.mode;mode.onchange=()=>{this.settings.mode=mode.value as SkySettings['mode'];this.save();this.invalidate();this.toast(this.settings.mode==='enhanced'?'增强观测：只显示更多真实目录星，不添加生成星点':'自然观星：克制星光与真实角尺寸');};
    const pollution=$<HTMLInputElement>('pollution');pollution.value=String(this.settings.lightPollution);text('pollution-value',`${pollution.value} / 9`);pollution.oninput=()=>{this.settings.lightPollution=Number(pollution.value);text('pollution-value',`${pollution.value} / 9`);this.save();this.invalidate();};
    for(const [id,k]of [['milkyway','milkyWay']] as const){const el=$<HTMLInputElement>(id);el.checked=this.settings[k];el.onchange=()=>{this.settings[k]=el.checked;this.save();this.invalidate();};}
    $('pause').onclick=()=>{this.clock.togglePause();this.invalidate();};
    $('forward').onclick=()=>{this.clock.setSpeed(nextSpeed(this.clock.speed,1));this.invalidate();};
    $('rewind').onclick=()=>{this.clock.setSpeed(nextSpeed(this.clock.speed,-1));this.invalidate();};
    $('now').onclick=()=>{this.clock.now();this.invalidate();this.toast('回到此刻 · 实时时间');};
    $('zoom-in').onclick=()=>this.view.zoom(0.7);$('zoom-out').onclick=()=>this.view.zoom(1/0.7);
    $('reset-view').onclick=()=>{this.setTracking(false);this.view.goTo(180,35,70);};
    document.querySelector<HTMLAnchorElement>('.brand')!.onclick=e=>{e.preventDefault();this.setTracking(false);this.view.goTo(180,35,70);};
    $('object-close').onclick=()=>{this.selected=null;this.setTracking(false);$('object-panel').hidden=true;$('selection-marker').hidden=true;this.invalidateOverlayLayout();};
    // At planetary magnification, a frozen goto position leaves the field while
    // the slew is still running. Center at the current scale and follow the
    // live target, just like search/inspection; deliberate pan can release it.
    $('object-center').onclick=()=>{this.centerSelected();this.setTracking(true);};
    $('object-track').onclick=()=>{this.setTracking(!this.tracking);if(this.tracking)this.centerSelected();};
    $('object-zoom').onclick=()=>{const body=this.getBody();this.centerSelected(body?this.inspectionFov(body):12);this.setTracking(true);};
    $('immersive').onclick=()=>this.setImmersive(true);$('exit-immersive').onclick=()=>this.setImmersive(false);
    const search=$<HTMLInputElement>('search');search.oninput=()=>this.search(search.value);search.onfocus=()=>{if(search.value)this.search(search.value);};search.onkeydown=e=>{if(e.key==='Enter'&&this.searchItems.length){e.preventDefault();this.chooseSearchTarget(this.searchItems[0].target);search.blur();}if(e.key==='Escape'){this.hideSearch();search.blur();}if(e.key==='ArrowDown'){e.preventDefault();$('search-results').querySelector('button')?.focus();}};
    this.listen(document,'pointerdown',e=>{if(!(e.target as Element).closest('.search-wrap'))this.hideSearch();});
    this.listen(window,'keydown',e=>{const tag=(e.target as Element).tagName;const editing=['INPUT','SELECT','TEXTAREA'].includes(tag);if(editing)return;if((e.target as Element).closest('button,a,[role=button],[role=option],[contenteditable=true]')&&e.key!=='Escape')return;if(e.key==='Escape'){if(this.immersive)this.setImmersive(false);else this.hideSearch();return;}if(document.querySelector('dialog[open]'))return;if(e.key==='/'){e.preventDefault();search.focus();}if(e.code==='Space'){e.preventDefault();this.clock.togglePause();this.invalidate();}if(e.key==='+'||e.key==='=')this.view.zoom(.8);if(e.key==='-')this.view.zoom(1.25);if(e.key.startsWith('Arrow')){e.preventDefault();this.setTracking(false);const c=this.view.camera;const step=c.fovDeg/10;this.view.goTo(c.azimuthDeg+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),c.altitudeDeg+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0));}});
    $('reload').onclick=()=>window.location.reload();
  }
  private resetGestureSegment(){
    this.panActive=false;
    const remaining=this.points.size===1?[...this.points.values()][0]:null;
    this.panAnchor=remaining?{...remaining}:null;
    this.initialPinch=this.points.size===2?this.pinchDistance():0;
    this.view.dragging=this.points.size>0;
  }
  private bindInput(){
    this.listen(this.canvas,'pointerdown',e=>{
      if(e.button!==0||this.points.has(e.pointerId))return;
      this.suppressClick=this.points.size>0; // New gesture vs additional contact.
      this.canvas.setPointerCapture(e.pointerId);
      this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      this.view.stop();this.resetGestureSegment();this.lastPointerTime=performance.now();
    });
    this.listen(this.canvas,'pointermove',e=>{
      const old=this.points.get(e.pointerId);if(!old)return;
      const dx=e.clientX-old.x,dy=e.clientY-old.y,now=performance.now();
      this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.points.size===2){
        const d=this.pinchDistance();
        if(d>0&&this.initialPinch>0)this.view.zoom(this.initialPinch/d);
        this.initialPinch=d;
      }else if(this.points.size===1){
        // Measure from this single-contact segment's anchor, not click suppression
        // or cumulative jitter. Re-anchor after every contact-count transition.
        const distance=this.panAnchor?Math.hypot(e.clientX-this.panAnchor.x,e.clientY-this.panAnchor.y):0;
        if(!this.panActive&&distance>=6){this.panActive=true;this.suppressClick=true;this.setTracking(false);}
        if(this.panActive)this.view.move(dx,dy,this.canvas.clientHeight,(now-this.lastPointerTime)/1000);
      }
      this.lastPointerTime=now;
    });
    const end=(e:PointerEvent)=>{
      if(!this.points.has(e.pointerId))return;
      const wasSingle=this.points.size===1,wasPanning=this.panActive;
      const click=e.type==='pointerup'&&wasSingle&&!this.suppressClick&&!wasPanning;
      this.points.delete(e.pointerId);
      if(e.type!=='pointerup')this.suppressClick=true;
      // Remove first: a synchronous lostpointercapture from release is a no-op.
      if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
      this.resetGestureSegment();
      if(click){this.view.stop();this.pick(e.clientX,e.clientY);}
      else if(this.points.size||e.type!=='pointerup'||!wasPanning||this.view.reducedMotion||performance.now()-this.lastPointerTime>120)this.view.stop();
      if(!this.points.size)this.suppressClick=false;
      this.lastPointerTime=performance.now();
    };
    this.listen(this.canvas,'pointerup',end);
    this.listen(this.canvas,'pointercancel',end);
    this.listen(this.canvas,'lostpointercapture',end);
    this.listen(this.canvas,'wheel',e=>{e.preventDefault();this.view.zoom(Math.exp(clamp(e.deltaY,-200,200)*.0015));},{passive:false});
  }
  private pinchDistance(){const p=[...this.points.values()];return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);}
  private getBody():SkyBody|undefined{return this.selected?.kind==='body'?this.state.bodies.find(b=>b.id===this.selected!.id):undefined;}
  private getStar():CatalogStar|undefined{return this.selected?.kind==='star'?this.stars.find(s=>s.id===this.selected!.id):undefined;}
  private constellationCenter(id:string){const cached=this.constellationCenters.get(id);if(cached)return cached;const c=CONSTELLATIONS.find(c=>c.abbr===id);if(!c)return null;let x=0,y=0,z=0;for(const [ra,dec]of c.lines.map(l=>[l[0],l[1]])){x+=Math.cos(dec)*Math.cos(ra);y+=Math.sin(dec);z+=Math.cos(dec)*Math.sin(ra);}const center={raRad:Math.atan2(z,x),decRad:Math.atan2(y,Math.hypot(x,z))};this.constellationCenters.set(id,center);return center;}
  private targetPosition(){const b=this.getBody();if(b)return {azimuthDeg:b.azimuthDeg,altitudeDeg:this.settings.refraction?b.apparentAltitudeDeg:b.altitudeDeg,raRad:b.raRad,decRad:b.decRad};const s=this.getStar();const eq=s|| (this.selected?.kind==='constellation'?this.constellationCenter(this.selected.id):null);if(!eq)return null;const horizontal=starHorizontal({...eq,id:'target',name:'target',magnitude:0},this.state,this.settings.refraction);return {...eq,azimuthDeg:horizontal.azimuthDeg,altitudeDeg:this.settings.refraction?horizontal.apparentAltitudeDeg:horizontal.altitudeDeg};}
  private openEarth(returnFocus:HTMLElement){
    if(this.disposed||this.earthInspector)return;
    this.hideSearch();
    // Sky selection, camera, follow, preferences and clock mode remain intact.
    // The main RAF below keeps ticking the existing clock, but skips sky work.
    this.earthInspector=new EarthInspector($<HTMLDialogElement>('earth-dialog'),()=>{
      this.earthInspector=null;if(!this.disposed)this.invalidate();
      // lastFrame is maintained by the lightweight clock RAF throughout the
      // dialog, so resuming cannot apply the whole modal duration a second time.
    },returnFocus);
    this.earthInspector.open();
  }
  private chooseSearchTarget(target:SearchTarget){if(target.kind==='inspector')this.openEarth($('search'));else this.select(target,true);}
  private select(target:Target,center=false){this.selected=target;this.setTracking(false);this.hideSearch();$('object-panel').hidden=false;this.updateObject();if(center){const body=this.getBody();this.centerSelected(body?this.inspectionFov(body):undefined);this.setTracking(true);}this.invalidateOverlayLayout();}
  private inspectionFov(body:SkyBody){return (body.id==='saturn'?inspectionRingFov:bodyInspectionFov)(body.angularDiameterRad,this.canvas.clientWidth,this.canvas.clientHeight);}
  private centerSelected(fov?:number){const p=this.targetPosition();if(!p)return;this.view.goTo(p.azimuthDeg,p.altitudeDeg,fov??this.view.camera.fovDeg);}
  private search(query:string){const q=query.trim().toLocaleLowerCase();const root=$('search-results');root.replaceChildren();this.searchItems=[];if(!q){this.hideSearch();return;}const match=(...words:string[])=>words.some(w=>w.toLocaleLowerCase().includes(q));
    for(const b of this.state.bodies){const n=BODY_NAMES[b.id]||b.name;if(match(n,b.name,b.id))this.searchItems.push({target:{kind:'body',id:b.id},name:n,english:b.id,subtitle:b.id==='sun'?'恒星':b.id==='moon'?'卫星':'行星'});}
    if(match('地球','Earth'))this.searchItems.push({target:{kind:'inspector',id:'earth'},name:'地球',english:'Earth',subtitle:'球体预览'});
    for(const s of this.stars)if(match(s.name,s.nameZh||''))this.searchItems.push({target:{kind:'star',id:s.id},name:s.nameZh||s.name,english:s.name,subtitle:'恒星'});
    for(const c of CONSTELLATIONS)if(match(c.name,c.abbr,CONSTELLATION_NAMES[c.abbr]||''))this.searchItems.push({target:{kind:'constellation',id:c.abbr},name:CONSTELLATION_NAMES[c.abbr]||c.name,english:c.name,subtitle:'星座'});
    this.searchItems=this.searchItems.slice(0,12);
    this.searchItems.forEach(item=>{const b=button('',()=>this.chooseSearchTarget(item.target));b.dataset.targetKind=item.target.kind;b.setAttribute('role','option');const icon=document.createElement('span');icon.className='result-icon';icon.textContent=item.target.kind==='constellation'?'⌁':item.target.kind==='body'||item.target.kind==='inspector'?'◉':'✦';const n=document.createElement('span');n.textContent=item.name;const sub=document.createElement('span');sub.className='result-sub';sub.textContent=item.subtitle;b.append(icon,n,sub);root.appendChild(b);});
    if(!this.searchItems.length){const e=document.createElement('div');e.className='empty-result';e.textContent='没有匹配天体，试试“月亮”或“织女星”';root.appendChild(e);}root.hidden=false;$('search').setAttribute('aria-expanded','true');
  }
  private hideSearch(){$('search-results').hidden=true;$('search').setAttribute('aria-expanded','false');}
  private pick(x:number,y:number){
    // Circular foreground optical disks win over background stars; unresolved
    // points alone keep the 25px locator tolerance. Centers may be off screen.
    const c=this.view.camera,w=this.canvas.clientWidth,h=this.canvas.clientHeight;
    const hit=this.state.bodies.filter(b=>bodyDiskContains(apparentDirection(b.direction,this.settings.refraction),b.angularDiameterRad,c,w,h,x,y)).sort((a,b)=>a.distanceAU-b.distanceAU)[0];
    if(hit){this.select({kind:'body',id:hit.id});this.setTracking(true);return;}
    let best:{target:Target;d:number}|null=null;const targets:[Target,number,number,number][]=[];for(const b of this.state.bodies){const diameter=h*Math.tan(b.angularDiameterRad/2)/Math.tan(c.fovDeg*Math.PI/360);if(b.id!=='sun'&&b.id!=='moon'&&diameter<1.4)targets.push([{kind:'body',id:b.id},b.raRad,b.decRad,b.magnitude]);}for(const s of this.stars)if(s.magnitude<4.5)targets.push([{kind:'star',id:s.id},s.raRad,s.decRad,s.magnitude]);for(const[t,ra,dec]of targets){const p=this.renderer.projectEquatorial(ra,dec,this.state,this.view.camera,this.settings.refraction);if(!p.visible||(this.settings.ground&&p.altitudeDeg<0))continue;const d=Math.hypot(x-p.x,y-p.y);if(d<25&&(!best||d<best.d))best={target:t,d};}if(best)this.select(best.target);}
  private buildLabels(){
    const root=$('sky-labels');
    const add=(target:Target,name:string,raRad=0,decRad=0,magnitude=0)=>{
      const constellation=target.kind==='constellation';
      const el=constellation?document.createElement('span'):button(name,()=>this.select(target),`sky-label${target.kind==='body'?' body-label':''}`);
      if(constellation){el.className='sky-label const-label';el.textContent=name;}
      el.hidden=true;el.tabIndex=-1;root.appendChild(el);
      const label:OverlayLabel={target,el,raRad,decRad,magnitude,width:Math.max(35,name.length*8)};
      this.overlayLabels.set(target.id,label);
      if(constellation){this.constellationLabels.set(target.id,el);this.overlayConstellations.push(label);}
      else {this.namedLabels.set(target.id,el as HTMLButtonElement);(target.kind==='body'?this.overlayBodies:this.overlayStars).push(label);}
    };
    for(const s of this.stars)if(s.magnitude<4)add({kind:'star',id:s.id},s.nameZh||s.name,s.raRad,s.decRad,s.magnitude);
    // Catalog order and name widths are immutable. Sort once, never per RAF or
    // collision pass. Only the nine changing body magnitudes need later sorting.
    this.overlayStars.sort((a,b)=>a.magnitude-b.magnitude);
    for(const id of Object.keys(BODY_NAMES))add({kind:'body',id},BODY_NAMES[id]);
    for(const direction of ['北','东北','东','东南','南','西南','西','西北']){
      const el=document.createElement('span');el.className='sky-label cardinal';el.textContent=direction;el.hidden=true;root.appendChild(el);this.cardinals.push(el);
    }
    for(const c of CONSTELLATIONS){const eq=this.constellationCenter(c.abbr)!;add({kind:'constellation',id:c.abbr},CONSTELLATION_NAMES[c.abbr]||c.name,eq.raRad,eq.decRad);}
  }
  /** The frame's only overlay layout-read phase, before renderer/DOM writes. */
  private readOverlayLayout(){
    const width=Math.max(1,this.canvas.clientWidth||this.canvas.width||1),height=Math.max(1,this.canvas.clientHeight||this.canvas.height||1);
    if(width!==this.overlayWidth||height!==this.overlayHeight){this.overlayWidth=width;this.overlayHeight=height;this.invalidateOverlayLayout();}
    if(this.overlayObstaclesDirty){
      this.overlayObstacles=[];
      if(!this.immersive)for(const el of this.overlayObstacleElements){
        if(el.hidden||getComputedStyle(el).display==='none')continue;
        const r=el.getBoundingClientRect();this.overlayObstacles.push({x:r.x,y:r.y,w:r.width,h:r.height});
      }
      this.overlayObstaclesDirty=false;
    }
    return {width,height};
  }
  private refreshOverlayCandidates(){
    if(this.overlayState===this.state)return;
    this.overlayState=this.state;
    const bodies=new Map(this.state.bodies.map(b=>[b.id,b]));
    for(const label of this.overlayBodies){label.body=bodies.get(label.target.id);if(label.body)label.magnitude=label.body.magnitude;}
    const ranked=this.overlayBodies.filter(label=>label.body).sort((a,b)=>a.magnitude-b.magnitude);
    // Merge pre-sorted static stars with the nine-body ephemeris order. Body
    // ties retain their original precedence; selection is handled separately.
    this.overlayCandidates=[];let i=0,j=0;
    while(i<ranked.length||j<this.overlayStars.length){
      if(i<ranked.length&&(j===this.overlayStars.length||ranked[i].magnitude<=this.overlayStars[j].magnitude))this.overlayCandidates.push(ranked[i++]);
      else this.overlayCandidates.push(this.overlayStars[j++]);
    }
  }
  private overlayEquatorialDirection(ra:number,dec:number):Vec3 {
    const h=transformDirection(this.state.equatorialToHorizontal,equatorialDirection(ra,dec)),n=Math.hypot(...h);
    return [h[0]/n,h[1]/n,h[2]/n];
  }
  private projectOverlay(label:OverlayLabel,width:number,height:number){
    if(label.directionState!==this.state){
      // Use the exact direction supplied to body drawing, rather than
      // rebuilding it from RA/Dec; avoid round-trip error at arcsecond FOV.
      label.direction=label.body?.direction||this.overlayEquatorialDirection(label.raRad,label.decRad);label.directionState=this.state;
    }
    return projectDirection(apparentDirection(label.direction!,this.settings.refraction),this.view.camera,width,height,this.settings.ground);
  }
  private overlayEligible(label:OverlayLabel,p:ProjectedPoint,width:number,height:number){
    if(!this.settings.labels||!p.visible)return false;
    if(label.target.kind==='constellation')return this.settings.constellations&&this.view.camera.fovDeg>=15&&(!this.settings.ground||p.altitudeDeg>=5);
    if(this.settings.ground&&p.altitudeDeg<0||p.x<8||p.x>width-55||p.y<8||p.y>height-25)return false;
    if(label.target.id===this.selected?.id)return true;
    if(this.settings.atmosphere&&this.state.sunAltitudeDeg>-6&&label.target.id!=='sun'&&label.target.id!=='moon'&&label.magnitude>-3)return false;
    return label.target.kind==='body'||label.magnitude<=(this.view.camera.fovDeg>45?2.3:4);
  }
  /** Collision membership may be cached for 50ms; screen positions never are. */
  private updateLabels(now:number,width:number,height:number){
    this.refreshOverlayCandidates();
    const placements=new Map<OverlayLabel,ProjectedPoint>();
    if(now-this.lastLabels>50){
      const obstacles=[...this.overlayObstacles],active:OverlayLabel[]=[];
      const selected=this.selected?this.overlayLabels.get(this.selected.id):undefined;
      let count=0;
      const consider=(label:OverlayLabel)=>{
        if(count>=18&&label!==selected)return;
        const p=this.projectOverlay(label,width,height);if(!this.overlayEligible(label,p,width,height))return;
        const x=p.x+7,y=p.y-8,w=label.width;
        if(label!==selected&&(count>=18||obstacles.some(r=>x<r.x+r.w+8&&x+w>r.x-8&&y<r.y+r.h+5&&y+16>r.y-5)))return;
        active.push(label);placements.set(label,p);obstacles.push({x,y,w,h:16});count++;
      };
      if(this.settings.labels){
        if(selected&&selected.target.kind!=='constellation')consider(selected);
        for(const label of this.overlayCandidates)if(label!==selected)consider(label);
        if(this.settings.constellations&&this.view.camera.fovDeg>=15)for(const label of this.overlayConstellations){
          const p=this.projectOverlay(label,width,height);if(!this.overlayEligible(label,p,width,height))continue;
          if(obstacles.some(r=>p.x<r.x+r.w+40&&p.x>r.x-40&&p.y<r.y+r.h+15&&p.y>r.y-15))continue;
          active.push(label);placements.set(label,p);
        }
      }
      this.activeOverlays=active;this.lastLabels=now;
    }else for(const label of this.activeOverlays){
      const p=this.projectOverlay(label,width,height);if(this.overlayEligible(label,p,width,height))placements.set(label,p);
    }
    // Write only the visible set and visibility transitions. No full-catalog
    // hide/show sweep, DOM reconstruction or layout/style reads in this phase.
    for(const label of this.visibleOverlays)if(!placements.has(label))label.el.hidden=true;
    this.visibleOverlays=new Set(placements.keys());
    for(const [label,p]of placements){
      placeOverlay(label.el,p,label.target.kind==='constellation');
      if(label.target.kind!=='constellation'){
        const pressed=String(label.target.id===this.selected?.id);
        if(label.el.getAttribute('aria-pressed')!==pressed)label.el.setAttribute('aria-pressed',pressed);
      }
    }
    this.updateSelectionMarker(width,height);
  }
  private updateSelectionMarker(width:number,height:number){
    const marker=$('selection-marker'),body=this.getBody();
    const eq=body?null:this.getStar()||(this.selected?.kind==='constellation'?this.constellationCenter(this.selected.id):null);
    if(!body&&!eq){if(!marker.hidden)marker.hidden=true;return;}
    const direction=body?.direction||this.overlayEquatorialDirection(eq!.raRad,eq!.decRad);
    const p=projectDirection(apparentDirection(direction,this.settings.refraction),this.view.camera,width,height,this.settings.ground);
    if(!p.visible){if(!marker.hidden)marker.hidden=true;return;}
    placeOverlay(marker,p,true);
    // Same isotropic physical angular-size/FOV scale as circular body disks.
    const px=body?height*Math.tan(body.angularDiameterRad/2)/Math.tan(this.view.camera.fovDeg*Math.PI/360):0;
    const size=Math.max(28,px+12)+'px';
    if(this.markerSize!==size){marker.style.width=size;marker.style.height=size;this.markerSize=size;}
  }
  private updateObject(){if(!this.selected)return;const p=this.targetPosition();if(!p)return;const b=this.getBody(),s=this.getStar(),con=this.selected.kind==='constellation'?CONSTELLATIONS.find(c=>c.abbr===this.selected!.id):undefined;
    text('object-name',b?(BODY_NAMES[b.id]||b.name):s?(s.nameZh||s.name):con?(CONSTELLATION_NAMES[con.abbr]||con.name):'');text('object-english',b?(b.id[0].toUpperCase()+b.id.slice(1)):s?s.name:con?.name||'');text('object-kind',b?(b.id==='moon'?'天然卫星':b.id==='sun'?'我们的恒星':'太阳系 · 行星'):s?'目录恒星':'星座 · 文化连线');
    text('object-visibility','全空可查看 · 点击居中或放大');$('object-visibility').classList.remove('below');
    const rows:[string,string][]=[];
    if(b||s)rows.push([b?'模型星等':'目录星等',(b?.magnitude??s!.magnitude).toFixed(2)]);
    if(b){rows.push(['距离',b.distanceAU<.01?`${Math.round(b.distanceAU*149597870.7).toLocaleString()} km`:`${b.distanceAU.toFixed(3)} AU`]);const arc=b.angularDiameterRad*180/Math.PI*3600;rows.push(['角直径',arc>120?`${(arc/60).toFixed(2)}′`:`${arc.toFixed(2)}″`]);if(b.id!=='sun')rows.push(['受光比例',`${(b.illuminatedFraction*100).toFixed(1)}%`]);if(b.id==='moon')rows.push(['月相',phaseName(this.state.moonPhaseDeg)]);}
    else if(s)rows.push(['距离','此星表未提供']);
    const h=((p.raRad*12/Math.PI)%24+24)%24;rows.push(['赤经 · J2000',`${Math.floor(h)}h ${((h%1)*60).toFixed(1)}m`],['赤纬 · J2000',`${(p.decRad*180/Math.PI).toFixed(2)}°`]);
    const dl=$('object-facts');dl.replaceChildren();for(const [name,val]of rows){const row=document.createElement('div');row.className='fact-row';const dt=document.createElement('dt');dt.textContent=name;const dd=document.createElement('dd');dd.textContent=val;row.append(dt,dd);dl.appendChild(row);}
    const note=b?.id==='sun'?'安全提醒：不要用肉眼或未加专业太阳滤镜的望远镜直接观测太阳。':b?.id==='moon'?'圆盘按真实角尺寸显示。月相为几何受光；纹理姿态/天平动尚未完整建模。':b?.id==='saturn'?'本体按真实角尺寸显示；主环按倾角呈椭圆，含前后遮挡及行星投向环的阴影，不含环投向本体的阴影。名称与圆框跟随本体。':b?.id==='venus'?'显示可见云层贴图，不是雷达地表影像。云纹为可视化近似，非此刻实拍。':b?'圆盘按真实角尺寸显示；远景行星光点已增强，便于找到暗行星；这不是天体直径或实际亮度。':s?'位置来自项目现有 J2000 星表，已变换到观测地天空；未加入恒星自行。':'连线用于辨认星座，不代表天体间存在物理连接。';text('object-note',note+(b?' 模型星等未计大气消光；显示位数不代表观测精度。':''));
  }
  private populatePlanets(){
    // Entries have no time-dependent text. Populate on open, never during RAF,
    // so a focused target stays connected while the observation clock runs.
    const root=$('planets-list');root.replaceChildren();
    for(const body of this.state.bodies){
      const b=button('',()=>{this.select({kind:'body',id:body.id},true);$<HTMLDialogElement>('planets-dialog').close();});
      b.dataset.body=body.id;
      const name=document.createElement('span');name.className='target-name';
      const dot=document.createElement('i');dot.className='target-dot';dot.style.backgroundColor=body.color;
      name.append(dot,document.createTextNode(BODY_NAMES[body.id]||body.name));
      const action=document.createElement('span');action.className='target-alt';action.textContent='定位查看 ↗';
      b.append(name,action);root.appendChild(b);
    }
    const earth=button('',()=>{$<HTMLDialogElement>('planets-dialog').close();this.openEarth($('planets-open'));});
    earth.dataset.inspector='earth';
    const name=document.createElement('span');name.className='target-name';name.textContent='🌍 地球';
    const action=document.createElement('span');action.className='target-alt';action.textContent='球体预览 ↗';
    earth.append(name,action);root.appendChild(earth);
  }
  private updateUI(){text('speed-label',speedText(this.clock.speed));text('pause-icon',this.clock.speed?'Ⅱ':'▷');$('pause').setAttribute('aria-label',this.clock.speed?'暂停时间':'继续时间');const c=this.view.camera;text('view-readout','全空视图 · 拖动探索');text('fov-readout',`视野 ${formatFov(c.fovDeg)}`);const stats=this.renderer.getStats();text('catalog-status',`${stats.catalogCount.toLocaleString()} 目录星 · ${this.namesWarning?'星名不可用（已降级）':stats.status||'晴空模拟'}`);$('catalog-status').title=`HiPS ${stats.hipsTiles} 瓦片 · 加载 ${stats.hipsLoading} · ${stats.fps.toFixed(0)} FPS（当前设备）`;this.updateObject();document.body.dataset.date=new Date(this.clock.timestamp).toISOString();document.body.dataset.location=this.location.name;}
  private setImmersive(v:boolean){this.immersive=v;document.body.classList.toggle('immersive',v);$('exit-immersive').hidden=!v;this.invalidateOverlayLayout();}
  private loop=(now:number)=>{if(this.disposed)return;try{const dt=(now-this.lastFrame)/1000;this.lastFrame=now;if(document.hidden){this.animation=requestAnimationFrame(this.loop);return;}const date=this.clock.tick(dt);if(this.earthInspector){this.animation=requestAnimationFrame(this.loop);return;}if(this.dirty||now-this.lastCompute>=Math.max(16,Math.min(250,1500/Math.max(1,Math.abs(this.clock.speed))))){this.state=computeSky(date,this.location);this.lastCompute=now;this.dirty=false;}
    if(this.tracking){const p=this.targetPosition();if(p){this.view.follow(p.azimuthDeg,p.altitudeDeg);}}
    this.view.update(dt);
    const {width,height}=this.readOverlayLayout();
    this.renderer.render(this.state,this.view.camera,this.settings);
    this.updateLabels(now,width,height);if(now-this.lastUI>200){this.updateUI();this.lastUI=now;}this.animation=requestAnimationFrame(this.loop);
  }catch(error){this.fail(error);}};
  fail(error:unknown){if(this.disposed)return;this.dispose();console.error(error);$('loading').hidden=false;text('loading-text',`${error instanceof Error?error.message:String(error)}。请重试或检查浏览器 WebGL2 支持。`);$('loading').querySelector('h2')!.textContent='暂时无法显示天空';$('reload').hidden=false;document.body.dataset.ready='error';this.canvas.dispatchEvent(new CustomEvent('galaxy-mode-error',{bubbles:true}));}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.loadAbort.abort();cancelAnimationFrame(this.animation);clearTimeout(this.toastTimer);
    for(const remove of this.cleanups.splice(0))remove();this.resizeObserver?.disconnect();this.resizeObserver=undefined;
    const ids=[...this.points.keys()];this.points.clear();for(const id of ids){try{if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);}catch{}}
    this.view.stop();this.view.dragging=false;
    // EarthInspector owns another context/RAF; close the dialog as well as disposing it.
    const earth=this.earthInspector;if(earth){const dialog=$<HTMLDialogElement>('earth-dialog');if(dialog?.open)dialog.close();earth.dispose();this.earthInspector=null;}
    if((window as any).__galaxy===this.debug)delete (window as any).__galaxy;this.debug=undefined;
    if(this.canvas.isConnected){document.body.classList.remove('immersive');for(const key of ['ready','date','location'])delete document.body.dataset[key];}
    this.namedLabels.clear();this.constellationLabels.clear();this.overlayLabels.clear();this.visibleOverlays.clear();this.activeOverlays=[];this.overlayCandidates=[];this.overlayBodies=[];this.overlayStars=[];this.overlayConstellations=[];this.overlayObstacleElements=[];this.stars=[];
    disposeRenderer(this.renderer);
  }
}
/** Returns the mount handle; signal abort disposes synchronously, including during init. */
export async function startObserver(signal?:AbortSignal){
  if(signal?.aborted)return;
  let app:ObserverApp|undefined;
  try{app=new ObserverApp(signal);await app.init();}
  catch(error){if(signal?.aborted||app?.isDisposed)return app;if(app)app.fail(error);else{console.error(error);$('loading').querySelector('h2')!.textContent='需要 WebGL2 支持';text('loading-text',String((error as Error).message));$('reload').hidden=false;$('reload').onclick=()=>location.reload();document.body.dataset.ready='error';}}
  return app;
}
