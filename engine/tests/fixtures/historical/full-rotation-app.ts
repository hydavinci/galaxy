import { lifetimeFetch, disposeRenderer } from '../modes/lifecycle';
import { computeSpace } from './world';
import { Navigation } from './navigation';
import { SpaceRenderer } from './renderer';
import { loadSpatialCatalog, type SpatialCatalog } from './catalog';
import type { CatalogStar3D, SpaceBody, SpaceRenderOptions, SpaceSnapshot } from './types';
import { formatDistance, formatSpeed, clamp } from './format';
import { focusSizeCssPixels, focusTicks, type FocusEdge } from './focus';
import { spaceCameraBasis } from './render-math';
import { ObservationClock, nextSpeed, speedText } from '../observer/controls';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const text=(id:string,value:string)=>{const e=$(id);if(e.textContent!==value)e.textContent=value;};
const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;return b;};
const BODY_ORDER=['sun','mercury','venus','earth','moon','mars','jupiter','saturn','uranus','neptune'];
const MOVE:Record<string,[number,number,number]>={left:[-1,0,0],right:[1,0,0],up:[0,1,0],down:[0,-1,0],forward:[0,0,1],back:[0,0,-1]};
type Target=SpaceBody|CatalogStar3D;
export class SpaceApp {
 private canvas=$<HTMLCanvasElement>('space-canvas');
 private renderer=new SpaceRenderer(this.canvas);
 private clock=new ObservationClock();
 private snapshot:SpaceSnapshot=computeSpace(new Date(this.clock.timestamp));
 private navigation=new Navigation(this.snapshot);
 private catalog:SpatialCatalog={stars:[],description:'',warning:null,metadata:null};
 private options:SpaceRenderOptions={labels:true,orbits:false,photographicBackground:true,cinematic:true};
 private keys=new Set<string>();private points=new Map<number,{x:number;y:number}>();private pad=new Map<number,string>();
 private multi=false;private travel=0;private panel=false;private labels=new Map<string,HTMLButtonElement>();
 private focusSize=0;
 private focusTickElements=new Map<FocusEdge,HTMLElement>();
 private raf=0;private lastFrame=performance.now();private lastScience=-Infinity;private lastUI=-Infinity;private dirty=true;
 private toastTimer=0;private disposed=false;private ready=false;private priorFocus:HTMLElement|null=null;private cleanups:Array<()=>void>=[];
 private loadAbort=new AbortController();private debug:unknown;
 get isDisposed(){return this.disposed;}
 constructor(signal?:AbortSignal){
  try{
  // Deep-space presentation is now the fixed mode, not a saved on/off choice.
  // Restore unrelated label preference, but never revive a legacy disabled effect.
  try{const v=JSON.parse(localStorage.getItem('galaxy-space-v1')||'null');if(typeof v?.labels==='boolean')this.options.labels=v.labels;}catch{}
  this.options.cinematic=true;this.options.photographicBackground=true;this.save();
  this.bindUI();this.bindInput();this.listen(window,'blur',()=>this.clearInput());
  this.listen(document,'visibilitychange',()=>{this.clearInput();this.lastFrame=performance.now();this.dirty=true;});
  this.listen(this.canvas,'webglcontextlost',e=>{e.preventDefault();this.fail('图形上下文已中断，请重新载入。');});
  this.listen(window,'pagehide',()=>this.dispose());
  if(signal){this.listen(signal,'abort',()=>this.dispose(),{once:true});if(signal.aborted)this.dispose();}
  }catch(error){this.dispose();throw error;}
 }
 private listen(target:EventTarget,name:string,fn:EventListener,options?:AddEventListenerOptions){target.addEventListener(name,fn,options);this.cleanups.push(()=>target.removeEventListener(name,fn,options));}
 async init(){
  if(this.disposed)return;
  this.catalog=await loadSpatialCatalog(lifetimeFetch(this.loadAbort.signal));if(this.disposed)return;this.navigation.setStars(this.catalog.stars);
  await this.renderer.init(this.catalog.stars);if(this.disposed)return;
  this.populateBodies();this.buildLabels();this.ready=true;
  text('space-catalog-note',this.catalog.description+'。HYG v4.1 · David Nash / Astronomy Nexus · CC BY-SA 4.0（筛选与坐标转换）。距离是历史目录估计，非完整宇宙。');
  $('space-loading').hidden=true;document.body.dataset.spaceReady='true';if(this.catalog.warning)this.toast(this.catalog.warning);
  this.updateUI();this.lastFrame=performance.now();this.raf=requestAnimationFrame(this.loop);
  const self=this;(window as any).__space=this.debug={get snapshot(){return self.snapshot;},get camera(){return self.navigation.camera;},get view(){return self.navigation.view;},get selected(){return self.navigation.view.selectedId;},get speed(){return self.clock.speed;},get stats(){return self.renderer.getStats();},get catalogCount(){return self.catalog.stars.length;},get options(){return {...self.options};},select:(id:string)=>self.select(id,true),setDate:(iso:string)=>{self.clock.setDate(new Date(iso));self.dirty=true;},resetEarth:()=>{self.navigation.resetEarth();self.panel=false;},dispose:()=>self.dispose()};
 }
 private body(t:Target|undefined):t is SpaceBody{return !!t&&'radiusKm' in t;}
 private target(id=this.navigation.view.selectedId):Target|undefined{return this.snapshot.bodies.find(t=>t.id===id)||this.catalog.stars.find(t=>t.id===id);}
 private save(){try{localStorage.setItem('galaxy-space-v1',JSON.stringify(this.options));}catch{}}
 private toast(message:string){text('space-toast',message);$('space-toast').hidden=false;clearTimeout(this.toastTimer);this.toastTimer=window.setTimeout(()=>$('space-toast').hidden=true,4500);}
 private dialogOpen(id:string){if(document.querySelector('dialog[open]'))return;this.clearInput();this.priorFocus=document.activeElement as HTMLElement;$<HTMLDialogElement>(id).showModal();}
 private dialogClose(d:HTMLDialogElement){d.close();this.priorFocus?.focus();this.priorFocus=null;}
 private bindUI(){
  document.querySelector<HTMLAnchorElement>('.brand')!.onclick=e=>{e.preventDefault();$('space-earth').click();};
  $('space-objects').onclick=()=>this.dialogOpen('space-objects-dialog');$('space-about').onclick=()=>this.dialogOpen('space-about-dialog');$('space-help').onclick=()=>this.dialogOpen('space-help-dialog');
  document.querySelectorAll<HTMLButtonElement>('[data-space-close]').forEach(b=>b.onclick=()=>this.dialogClose(b.closest('dialog')!));
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach(d=>{this.listen(d,'cancel',()=>this.clearInput());this.listen(d,'click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect(),m=e as MouseEvent;if(m.clientX<r.left||m.clientX>r.right||m.clientY<r.top||m.clientY>r.bottom)this.dialogClose(d);});});
  $('space-mode').onclick=()=>{this.navigation.setMode(this.navigation.view.mode==='orbit'?'free':'orbit');this.updateUI();};
  $('space-label-toggle').onclick=()=>{this.options.labels=!this.options.labels;this.save();this.updateUI();};
  $('space-earth').onclick=()=>{this.navigation.resetEarth();this.panel=false;$<HTMLInputElement>('space-speed').value='0';text('space-speed-factor','自动 ×1');this.updateUI();};
  $('space-system').onclick=()=>{this.navigation.frameSystem();this.panel=false;this.updateUI();};
  $('space-nearer').onclick=()=>this.navigation.dolly(.8);$('space-farther').onclick=()=>this.navigation.dolly(1.25);
  $('space-object-close').onclick=()=>{this.panel=false;this.updateUI();};$('space-go').onclick=()=>{const id=this.navigation.view.selectedId;if(id)this.select(id,true);};
  $('space-pause').onclick=()=>{this.clock.togglePause();this.dirty=true;this.updateUI();};
  $('space-forward').onclick=()=>{this.clock.setSpeed(nextSpeed(this.clock.speed,1));this.dirty=true;this.updateUI();};$('space-rewind').onclick=()=>{this.clock.setSpeed(nextSpeed(this.clock.speed,-1));this.dirty=true;this.updateUI();};$('space-now').onclick=()=>{this.clock.now();this.dirty=true;this.updateUI();};
  const speed=$<HTMLInputElement>('space-speed');speed.oninput=()=>{const factor=10**Number(speed.value);this.navigation.setSpeedMultiplier(factor);text('space-speed-factor',`自动 ×${factor<1?factor.toFixed(2):factor.toLocaleString('zh-CN',{maximumFractionDigits:1})}`);};
  // Keep range focus while a drag/key-repeat is in progress. Commit returns
  // keyboard flight to the canvas, without navigation or scrolling the page.
  let speedPointer:number|null=null;const speedKeys=new Set<string>();
  const rangeKeys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
  const returnFlightFocus=()=>{if(!this.disposed&&this.canvas.isConnected&&!document.querySelector('dialog[open]')&&document.activeElement===speed)this.canvas.focus({preventScroll:true});};
  this.listen(speed,'pointerdown',event=>{const e=event as PointerEvent;if(e.button===0)speedPointer=e.pointerId;});
  for(const type of ['pointerup','pointercancel'] as const)this.listen(window,type,event=>{const e=event as PointerEvent;if(e.pointerId!==speedPointer)return;speedPointer=null;if(!speedKeys.size)returnFlightFocus();});
  this.listen(speed,'keydown',event=>{const e=event as KeyboardEvent;if(rangeKeys.has(e.key))speedKeys.add(e.key);});
  this.listen(speed,'keyup',event=>{const e=event as KeyboardEvent;if(speedKeys.delete(e.key)&&speedPointer===null&&!speedKeys.size)returnFlightFocus();});
  this.listen(speed,'change',()=>{if(speedPointer===null&&!speedKeys.size)returnFlightFocus();});
  this.listen(speed,'blur',()=>{speedPointer=null;speedKeys.clear();});
  this.listen(window,'blur',()=>{speedPointer=null;speedKeys.clear();});
  const search=$<HTMLInputElement>('space-search');search.oninput=()=>{if(this.ready)this.search(search.value);};search.onfocus=()=>{if(this.ready&&search.value)this.search(search.value);};search.onkeydown=e=>{if(e.key==='Enter')$('space-results').querySelector<HTMLButtonElement>('button')?.click();else if(e.key==='ArrowDown'){e.preventDefault();$('space-results').querySelector<HTMLButtonElement>('button')?.focus();}else if(e.key==='Escape'){this.hideSearch();search.blur();}};
  this.listen(document,'pointerdown',e=>{if(!(e.target as Element).closest('.search-wrap'))this.hideSearch();});
  this.listen(window,'keydown',event=>{const e=event as KeyboardEvent,target=e.target as Element;if(document.querySelector('dialog[open]')||target.closest('input,textarea,select,[contenteditable=true]'))return;if(e.key==='Escape'){this.hideSearch();this.navigation.stop();this.clearInput();return;}if(target.closest('button,a'))return;if(e.key==='/'){e.preventDefault();search.focus();return;}if(e.code==='Space'){e.preventDefault();this.clock.togglePause();this.dirty=true;return;}if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}});
  this.listen(window,'keyup',e=>this.keys.delete((e as KeyboardEvent).code));
  document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(b=>{this.listen(b,'pointerdown',event=>{const e=event as PointerEvent;e.preventDefault();this.pad.set(e.pointerId,b.dataset.move!);b.setPointerCapture?.(e.pointerId);});for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(b,type,e=>this.pad.delete((e as PointerEvent).pointerId));});
  $('space-retry').onclick=()=>location.reload();
 }
 private bindInput(){
  this.listen(this.canvas,'pointerdown',event=>{const e=event as PointerEvent;if(e.button!==0)return;this.canvas.focus();this.canvas.setPointerCapture?.(e.pointerId);this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});this.navigation.stop();if(this.points.size===1){this.travel=0;this.multi=false;}else this.multi=true;});
  this.listen(this.canvas,'pointermove',event=>{const e=event as PointerEvent,old=this.points.get(e.pointerId);if(!old)return;const before=this.pinch();this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});const dx=e.clientX-old.x,dy=e.clientY-old.y;this.travel+=Math.hypot(dx,dy);if(this.points.size===2){const after=this.pinch();if(before>0&&after>0)this.navigation.dolly(before/after);}else if(this.points.size===1&&this.travel>=4){if(this.navigation.view.mode==='orbit')this.navigation.orbit(dx,dy,this.canvas.clientWidth,this.canvas.clientHeight);else this.navigation.look(dx,dy,this.canvas.clientWidth,this.canvas.clientHeight);}});
  const end=(event:Event)=>{const e=event as PointerEvent;if(!this.points.has(e.pointerId))return;const pick=e.type==='pointerup'&&this.points.size===1&&!this.multi&&this.travel<4;this.points.delete(e.pointerId);if(this.canvas.hasPointerCapture?.(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);if(pick&&this.ready){const id=this.renderer.pick(e.clientX,e.clientY,this.snapshot,this.navigation.view);if(id)this.select(id,false);}if(!this.points.size){this.travel=0;this.multi=false;}};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(this.canvas,type,end);
  this.listen(this.canvas,'wheel',event=>{const e=event as WheelEvent;e.preventDefault();this.navigation.dolly(Math.exp(clamp(e.deltaY,-200,200)*.002));},{passive:false});
 }
 private clearInput(){this.keys.clear();this.pad.clear();const ids=[...this.points.keys()];this.points.clear();for(const id of ids)if(this.canvas.hasPointerCapture?.(id))this.canvas.releasePointerCapture(id);this.travel=0;this.multi=false;}
 private pinch(){const p=[...this.points.values()];return p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0;}
 private select(id:string,fly:boolean){if(!this.target(id))return;this.navigation.selectTarget(id,fly);this.panel=true;this.hideSearch();this.updateUI();}
 private hideSearch(){$('space-results').hidden=true;$('space-search').setAttribute('aria-expanded','false');}
 private search(query:string){const q=query.trim().toLocaleLowerCase(),root=$('space-results');root.replaceChildren();if(!q){this.hideSearch();return;}const match=(t:Target)=>[t.name,this.body(t)?t.nameEn:t.nameZh||'',t.id].some(s=>s.toLocaleLowerCase().includes(q));const targets:Target[]=[...this.snapshot.bodies.filter(match),...this.catalog.stars.filter(match)].slice(0,12);
  for(const t of targets){const b=button('',()=>this.select(t.id,true)),n=document.createElement('span'),s=document.createElement('small');n.textContent=this.body(t)?t.name:t.nameZh||t.name;s.textContent=this.body(t)?t.kind==='moon'?'卫星':t.id==='sun'?'恒星':'行星':`${t.distancePc.toFixed(2)} pc · 目录星`;b.append(n,s);b.dataset.target=t.id;root.appendChild(b);}if(!targets.length){const e=document.createElement('div');e.className='search-empty';e.textContent='没有匹配，试试“地球”“土星”或“Sirius”';root.appendChild(e);}root.hidden=false;$('space-search').setAttribute('aria-expanded','true');
 }
 private populateBodies(){const root=$('space-body-list');root.replaceChildren();for(const id of BODY_ORDER){const t=this.snapshot.bodies.find(b=>b.id===id);if(!t)continue;const b=button('',()=>{this.dialogClose($('space-objects-dialog'));this.select(id,true);}),dot=document.createElement('span'),n=document.createElement('span'),s=document.createElement('small');dot.className='body-dot';dot.style.background=dot.style.color=t.color;n.textContent=t.name;s.textContent='前往 ↗';b.dataset.spaceBody=id;b.append(dot,n,s);root.appendChild(b);}}
 private buildLabels(){const root=$('space-labels');for(const body of this.snapshot.bodies){const b=button(body.name,()=>this.select(body.id,false));b.className='space-label';b.hidden=true;b.tabIndex=-1;root.appendChild(b);this.labels.set(body.id,b);}}
 private updateLabels(){
  const c=this.navigation.camera;
  for(const b of this.snapshot.bodies){const label=this.labels.get(b.id)!,p=this.renderer.project(b.positionAU,c);label.hidden=!this.options.labels||!p.visible;if(!label.hidden){label.style.transform=`translate(${p.x}px,${p.y}px) translate(8px,-50%)`;label.dataset.selected=String(b.id===this.navigation.view.selectedId);}}
  const t=this.target(),marker=$('space-crosshair');if(!t){marker.hidden=true;return;}
  const p=this.renderer.project(t.positionAU,c);
  const forward=spaceCameraBasis(c).forward;
  const depth=t.positionAU.reduce((sum,value,i)=>sum+(value-c.positionAU[i])*forward[i],0);
  const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
  const size=focusSizeCssPixels(this.body(t)?t.radiusKm:null,p.distanceAU,c.fovDeg,width,height);
  if(!(p.distanceAU>0&&depth/p.distanceAU>1e-15)||size<=0){marker.hidden=true;return;}
  const ticks=focusTicks(p.x,p.y,size,width,height);
  marker.hidden=!ticks.some(tick=>tick.visible);if(marker.hidden)return;
  // No viewport-sized clamp: each visible tick stays OUTSIDE the true limb.
  // A huge/offscreen globe is clipped naturally, never marked over its interior.
  if(size!==this.focusSize){marker.style.width=marker.style.height=`${size}px`;this.focusSize=size;}
  marker.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
  if(!this.focusTickElements.size)for(const el of marker.querySelectorAll<HTMLElement>('[data-focus-edge]'))this.focusTickElements.set(el.dataset.focusEdge as FocusEdge,el);
  for(const tick of ticks){const el=this.focusTickElements.get(tick.edge);if(el&&el.hidden!==!tick.visible)el.hidden=!tick.visible;}

 }
 private updateUI(){const view=this.navigation.view,t=this.target(),body=this.body(t)?t:null,info=this.navigation.getSelectedInfo();
  const distance=info?.distanceAU??Math.hypot(...view.camera.positionAU);text('space-mode-readout',view.mode==='orbit'?'环绕模式':'自由飞行');text('space-mode-label',view.mode==='orbit'?'自由飞行':'环绕目标');$('space-mode').setAttribute('aria-pressed',String(view.mode==='free'));
  const name=t?(body?t.name:(t as CatalogStar3D).nameZh||t.name):'太阳系';text('space-range',t?`距${name} ${formatDistance(distance)}`:`距太阳 ${formatDistance(distance)}`);text('space-speed-readout',formatSpeed(view.speedAUPerSecond));text('space-time-speed',speedText(this.clock.speed));text('space-pause',this.clock.speed?'Ⅱ':'▷');$('space-pause').setAttribute('aria-label',this.clock.speed?'暂停时间':'继续时间');
  $('space-label-toggle').setAttribute('aria-pressed',String(this.options.labels));text('journey-title',name==='地球'?'我们的蓝色星球':name);text('journey-kind',t&&!body?'恒星目录 · 三维空间':'太阳系 · 三维空间');text('journey-subtitle',view.mode==='orbit'?'拖动环绕 · 滚轮靠近 · 切换自由飞行离开目标':'WASD / QE 移动 · 拖动转向 · 滚轮前后飞行');
  $('space-object').hidden=!this.panel||!t;document.body.classList.toggle('object-open',this.panel&&!!t);
  if(this.panel&&t){text('space-object-name',name);text('space-object-english',body?body.nameEn:t.name);text('space-object-kind',body?(body.id==='sun'?'恒星':body.kind==='moon'?'天然卫星':'行星'):'目录恒星 · 固定历元');const rows:Array<[string,string]>=[['相机距离',formatDistance(distance)]];
   if(body){rows.push(['半径',`${body.radiusKm.toLocaleString()} km`]);if(info?.illuminatedFraction!==null&&info?.illuminatedFraction!==undefined&&body.id!=='sun')rows.push(['相位受光估计',`${(info.illuminatedFraction*100).toFixed(1)}%`]);rows.push(['当前空间位置','日心 J2000']);}
   else {const s=t as CatalogStar3D;rows.push(['目录距太阳',`${s.distancePc.toFixed(3)} pc`],['绝对星等',s.absoluteMagnitude.toFixed(2)],['数据来源',s.sourceId]);}
   const dl=$('space-facts');dl.replaceChildren();for(const [k,v] of rows){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');row.className='fact-row';dt.textContent=k;dd.textContent=v;row.append(dt,dd);dl.appendChild(row);}
   text('space-object-note',body?'真实半径与近似三维星历；非专业测轨精度。材质、大气、曝光与相位百分比为可视化近似。飞行改变相机位置，不改变天体大小。':'位置与距离来自目录，固定J2000历元；暂未提供真实恒星表面影像，也不生成虚构行星系统。');
  }
  const stats=this.renderer.getStats();text('space-status',`${this.catalog.stars.length.toLocaleString()} 三维目录星 · ${stats.status||'太阳系真实尺度'}${this.catalog.warning?' · 星表降级':''}`);$('space-status').title='三维位置与可视化显示，不是完整宇宙动力学模拟';document.body.dataset.spaceMode=view.mode;
 }
 private loop=(now:number)=>{if(this.disposed)return;try{const dt=clamp((now-this.lastFrame)/1000,0,.1);this.lastFrame=now;if(document.hidden){this.raf=requestAnimationFrame(this.loop);return;}const date=this.clock.tick(dt);
  if(this.dirty||now-this.lastScience>=Math.max(16,Math.min(250,1500/Math.max(1,Math.abs(this.clock.speed))))){this.snapshot=computeSpace(date);this.navigation.setSnapshot(this.snapshot);this.lastScience=now;this.dirty=false;}
  if(!document.querySelector('dialog[open]')){const m:[number,number,number]=[Number(this.keys.has('KeyD'))-Number(this.keys.has('KeyA')),Number(this.keys.has('KeyE'))-Number(this.keys.has('KeyQ')),Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS'))];for(const id of this.pad.values())for(let i=0;i<3;i++)m[i]+=MOVE[id][i];if(Math.hypot(...m)>0)this.navigation.move(m,dt,this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'));}
  this.navigation.update(dt);this.renderer.render(this.snapshot,this.navigation.view,this.options,now);this.updateLabels();if(now-this.lastUI>150){this.updateUI();this.lastUI=now;}this.raf=requestAnimationFrame(this.loop);
 }catch(error){this.fail(error instanceof Error?error.message:String(error));}};
 fail(message:string){if(this.disposed)return;this.dispose();$('space-loading').hidden=false;text('space-loading-text',message);$('space-loading').querySelector('h2')!.textContent='暂时无法进入三维空间';$('space-retry').hidden=false;document.body.dataset.spaceReady='error';this.clearInput();console.error(message);this.canvas.dispatchEvent(new CustomEvent('galaxy-mode-error',{bubbles:true}));}
 dispose(){if(this.disposed)return;this.disposed=true;this.ready=false;this.loadAbort.abort();cancelAnimationFrame(this.raf);clearTimeout(this.toastTimer);this.clearInput();for(const fn of this.cleanups)fn();this.cleanups=[];
  if((window as any).__space===this.debug)delete (window as any).__space;this.debug=undefined;
  if(this.canvas.isConnected){delete document.body.dataset.spaceReady;delete document.body.dataset.spaceMode;document.body.classList.remove('object-open');}
  this.labels.clear();this.focusTickElements.clear();this.navigation.dispose();disposeRenderer(this.renderer);
 }
}
/** Returns the mount handle; signal abort disposes synchronously, including during init. */
export async function startSpace(signal?:AbortSignal){
 if(signal?.aborted)return;
 let app:SpaceApp|undefined;
 try{app=new SpaceApp(signal);await app.init();}
 catch(error){if(signal?.aborted||app?.isDisposed)return app;if(app)app.fail(error instanceof Error?error.message:String(error));else{console.error(error);$('space-loading').hidden=false;text('space-loading-text',error instanceof Error?error.message:String(error));$('space-retry').hidden=false;$('space-retry').onclick=()=>location.reload();document.body.dataset.spaceReady='error';}}
 return app;
}
