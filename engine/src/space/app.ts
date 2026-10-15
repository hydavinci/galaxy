import type {SpacecraftTarget} from './spacecraft-target';
import {FactList,patchHidden,patchAttribute} from './dom-patches';
import { lifetimeFetch, disposeRenderer } from '../modes/lifecycle';
import { computeSpace } from './world';
import { Navigation } from './navigation';
import { SpaceRenderer } from './renderer';
import { loadSpatialCatalog, type SpatialCatalog } from './catalog';
import { AU_KM, type CatalogStar3D, type SpaceBody, type SpaceRenderOptions, type SpaceSnapshot } from './types';
import { formatDistance, formatSpeed, clamp } from './format';
import { focusSizeCssPixels, focusTicks, type FocusEdge } from './focus';
import { spaceCameraBasis } from './render-math';
import { getStellarModel } from './stellar-model';
import { ObservationPanel, surfaceEvidence, observationMap } from './observations';
import spacecraftData from './spacecraft-data.json';
import { SpacecraftLibrary, type SpacecraftData, type SpacecraftPositionInfo } from './spacecraft';
import { validateTrajectoryData, sampleTrajectory, type TrajectoryDataset, type TrajectoryRecord, type CraftState } from './trajectories';
import { TrajectoryOverlay } from './trajectory-overlay';
import {trajectoryViewFrame,trajectoryViewDistance,trajectoryViewDirection,type TrajectoryViewFrame} from './trajectory-view';
import { StarLabels, nameUnits, labelNameWidth, type LabelRect } from './labels';
import { ObservationClock } from '../observer/controls';
import { nextSpaceTimeSpeed, spaceTimeText, spaceTimeDescription } from './time-controls';
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
 private keys=new Set<string>();private points=new Map<number,{x:number;y:number;pointerType:string;button:number}>();private pad=new Map<number,string>();
 private multi=false;private travel=0;private labelDragUntil=0;private panel=false;private labels=new Map<string,HTMLButtonElement>();
 private starLabels:StarLabels|undefined;private starTargets=new Map<string,CatalogStar3D>();private bodyNameUnits=new Map<string,number>();
 private facts=new Map<string,FactList>();private uiLayoutKey='';
 private focusSize=0;private stellarSourcesId='';private observationPanel:ObservationPanel|undefined;
 private focusTickElements=new Map<FocusEdge,HTMLElement>();private spacecraftLibrary:SpacecraftLibrary|undefined;
 private trajectoryData:TrajectoryDataset|undefined;private trajectoryOverlay:TrajectoryOverlay|undefined;
 private craftStates:CraftState[]=[];private craftTargets:SpacecraftTarget[]=[];private selectedMission:string|null=null;
 private trajectoryRequest:AbortController|undefined;private trajectoryLoading=false;private trajectoryError='';
 private spacecraftVisible=true;private trajectoryVisible=true;private trajectoryTimer=0;private trajectoryRenderStamp='';private trajectoryFrames=new Map<string,TrajectoryViewFrame>();
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
  this.catalog=await loadSpatialCatalog(lifetimeFetch(this.loadAbort.signal));if(this.disposed)return;this.navigation.setStars(this.catalog.stars);this.starTargets=new Map(this.catalog.stars.map(star=>[star.id,star]));
  await this.renderer.init(this.catalog.stars);if(this.disposed)return;
  this.populateBodies();this.buildLabels();const observationRoot=$('space-observation');if(observationRoot)this.observationPanel=new ObservationPanel(observationRoot);this.ready=true;
  text('space-catalog-note',this.catalog.description+'。HYG v4.1 · David Nash / Astronomy Nexus · CC BY-SA 4.0（筛选与坐标转换）。距离是历史目录估计，非完整宇宙。');
  $('space-loading').hidden=true;document.body.dataset.spaceReady='true';if(this.catalog.warning)this.toast(this.catalog.warning);
  this.updateUI();this.lastFrame=performance.now();this.raf=requestAnimationFrame(this.loop);
  const self=this;(window as any).__space=this.debug={get snapshot(){return self.snapshot;},get camera(){return self.navigation.camera;},get view(){return self.navigation.view;},get selected(){return self.navigation.view.selectedId;},get speed(){return self.clock.speed;},get stats(){return self.renderer.getStats();},get catalogCount(){return self.catalog.stars.length;},get options(){return {...self.options};},select:(id:string)=>self.select(id,true),setDate:(iso:string)=>{self.clock.setDate(new Date(iso));self.dirty=true;},resetEarth:()=>{self.navigation.resetEarth();self.panel=false;},dispose:()=>self.dispose()};
 }
 private renderTrajectories(now:number):void {const camera=this.navigation.camera,record=this.trajectoryVisible?this.trajectoryRecord():undefined;const stamp=[this.snapshot.date.getTime(),...camera.positionAU,camera.azimuthDeg,camera.altitudeDeg,camera.rollDeg??0,camera.fovDeg,this.canvas.clientWidth,this.canvas.clientHeight,this.craftStates.length,record?.missionId??'',this.spacecraftVisible].join('|');if(stamp===this.trajectoryRenderStamp)return;this.trajectoryRenderStamp=stamp;this.trajectoryOverlay?.update(this.snapshot,camera,this.craftStates,record,this.spacecraftVisible,now);}
 private trajectoryRecord():TrajectoryRecord|undefined{return this.trajectoryData?.records.find(r=>r.missionId===this.selectedMission);}
 private bindTrajectoryUI():void {
  const click=(id:string,fn:()=>void)=>{const node=$(id);if(node)this.listen(node,'click',()=>{if(!this.disposed)fn();});};
  click('space-craft-close',()=>{this.selectedMission=null;this.panel=false;this.navigation.clearSpacecraftSelection();this.updateUI();});
  click('space-craft-center',()=>{if(this.selectedMission)this.showCraft(this.selectedMission,false,true,'follow');});
  click('space-craft-observe',()=>{if(this.selectedMission)this.showCraft(this.selectedMission,false,true,'observe');});
  click('space-craft-period',()=>{if(this.selectedMission)this.showCraft(this.selectedMission,true);});
  click('space-craft-path',()=>{this.trajectoryVisible=!this.trajectoryVisible;this.updateUI();});
  click('space-craft-display',()=>{this.spacecraftVisible=!this.spacecraftVisible;this.updateUI();});
  click('space-craft-time-apply',()=>{const value=$<HTMLInputElement>('space-craft-time').value;if(!value)return;const d=new Date(value+'Z');if(!Number.isFinite(d.getTime()))return;try{const next=computeSpace(d);this.clock.setDate(d);this.clock.setSpeed(0);this.snapshot=next;this.syncCraftStates();this.navigation.setSnapshot(next,this.craftTargets);this.dirty=true;this.updateUI();}catch{this.toast('时间超出场景支持范围。');}});
 }
 private syncCraftStates():void {
  this.craftStates=this.trajectoryData?.records.flatMap(record=>{const state=sampleTrajectory(record,this.snapshot.date.getTime(),this.snapshot);return state?[state]:[];})??[];
  this.craftTargets=this.craftStates.map(state=>({id:`craft:${state.missionId}`,missionId:state.missionId,name:state.name,nameEn:spacecraftData.records.find(r=>r.id===state.missionId)?.nameEn??state.name,kind:'spacecraft',positionAU:state.positionAU,viewDistanceAU:state.viewDistanceAU,centerBodyId:state.centerBodyId}));
 }
 private async loadTrajectories():Promise<void> {
  if(this.disposed||this.trajectoryLoading||this.trajectoryData)return;
  const controller=new AbortController();this.trajectoryRequest=controller;this.trajectoryLoading=true;this.trajectoryError='';this.updateTrajectoryUI();
  this.trajectoryTimer=window.setTimeout(()=>controller.abort(),20000);
  let abort:()=>void=()=>{};
  try{const request=async()=>{const response=await fetch('./data/spacecraft-trajectories.json',{signal:controller.signal,cache:'no-cache'});if(!response.ok)throw new Error('位置数据暂不可用');const body=await response.text();if(new TextEncoder().encode(body).byteLength>6000000)throw new Error('位置数据超出大小限制');return validateTrajectoryData(JSON.parse(body));};
   const data=await new Promise<TrajectoryDataset>((resolve,reject)=>{abort=()=>reject(new Error('Position load aborted'));controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted){abort();return;}request().then(resolve,reject);});
   if(this.disposed)return;if(controller.signal.aborted)throw new Error('Position load aborted');this.trajectoryData=data;this.syncCraftStates();this.navigation.setSpacecraft(this.craftTargets);this.spacecraftVisible=true;}
  catch{if(!this.disposed)this.trajectoryError='位置数据载入失败或超时，可重试；原任务资料仍可浏览。';}
  finally{controller.signal.removeEventListener('abort',abort);clearTimeout(this.trajectoryTimer);this.trajectoryTimer=0;if(this.trajectoryRequest===controller)this.trajectoryRequest=undefined;this.trajectoryLoading=false;if(!this.disposed)this.updateTrajectoryUI();}
 }
 private showCraft(missionId:string,availablePeriod:boolean,fly=true,viewMode:'observe'|'follow'='observe'):void {
  if(this.disposed)return;const record=this.trajectoryData?.records.find(r=>r.missionId===missionId);if(!record||record.kind==='unavailable'){this.toast('该任务没有已载入、可核验的位置。');return;}
  if(availablePeriod){const epoch=record.kind==='ephemeris'?record.defaultMs:record.siteEpochMs;this.clock.setDate(new Date(epoch));this.clock.setSpeed(0);this.snapshot=computeSpace(new Date(epoch));this.syncCraftStates();this.navigation.setSnapshot(this.snapshot,this.craftTargets);this.dirty=true;}
  const target=this.craftTargets.find(t=>t.missionId===missionId);if(!target){this.toast('所选时间超出该任务数据覆盖；请使用“查看可用时段”。');return;}
  this.selectedMission=missionId;this.panel=false;this.spacecraftVisible=true;this.trajectoryVisible=true;
  if(record.kind==='ephemeris'&&viewMode==='observe'){let frame=this.trajectoryFrames.get(missionId);if(!frame){frame=trajectoryViewFrame(record);this.trajectoryFrames.set(missionId,frame);}this.navigation.observeSpacecraft(target.id,frame.offsetAU,trajectoryViewDistance(frame,this.navigation.camera.fovDeg,this.canvas.clientWidth,this.canvas.clientHeight),trajectoryViewDirection(frame,this.craftStates.find(s=>s.missionId===missionId)!.relativePositionAU),fly);}
  else this.navigation.selectTarget(target.id,fly);
  const dialog=$<HTMLDialogElement>('space-spacecraft-dialog');if(dialog?.open)this.dialogClose(dialog);this.clearInput();this.hideSearch();this.updateUI();this.canvas.focus({preventScroll:true});
 }
 private updateFacts(id:string,rows:readonly (readonly [string,string])[]):void {let list=this.facts.get(id);if(!list){list=new FactList($(id));this.facts.set(id,list);}if(list.update(rows))this.starLabels?.invalidateLayout();}
 private updateTrajectoryUI():void {
  if(this.disposed)return;const utc=(ms:number)=>new Date(ms).toISOString().replace('T',' ').replace('.000Z',' UTC'),quality:Record<string,string>={reconstructed:'轨道重建',predicted:'官方预测（非遥测）',mixed:'重建 / 预测混合', 'tle-derived':'TLE 推算（短期有效）','historical-site':'历史着陆位置'};
  if($<HTMLDialogElement>('space-spacecraft-dialog')?.open){
  const values=new Map<string,SpacecraftPositionInfo>();for(const record of this.trajectoryData?.records??[]){const state=this.craftStates.find(c=>c.missionId===record.missionId);let message=record.kind==='unavailable'?record.notes:record.kind==='surface-site'?`${record.label} · 资料日期锚点 ${utc(record.siteEpochMs)}；不是精确着陆时刻或巡视器当前位置，详见来源说明。`:`${quality[record.quality]??record.quality} · 覆盖 ${utc(record.startMs)} 至 ${utc(record.endMs)}。${state?'所选时刻有数据。':'所选时间无覆盖，不外推。'} 中心天体：${record.centerBodyId}。`;values.set(record.missionId,{text:message,canShow:!!state,canVisit:record.kind!=='unavailable',visitLabel:record.kind==='surface-site'?'查看历史地点（暂停到资料日期）':'查看可用时段（切换并暂停时间）',sourceUrl:record.sourceUrl});}
  const loadStatus=this.trajectoryLoading?'正在载入已核验的位置与轨迹…':this.trajectoryError||(this.trajectoryData?'位置为官方星历采样插值 / 历史地点，非实时遥测。轨迹在中心天体共动坐标中显示；不代表所有历史日心位置。':'位置数据尚未载入；打开资料库后按需加载。');
  this.spacecraftLibrary?.setPositionInfo(values,loadStatus);
  }
  const display=$('space-craft-display');if(display){patchHidden(display,!this.trajectoryData);patchAttribute(display,'aria-pressed',String(this.spacecraftVisible));text('space-craft-display',this.spacecraftVisible?'隐藏航天器':'显示航天器');}
  const panel=$('space-craft-panel');if(!panel)return;const record=this.trajectoryRecord();patchHidden(panel,!record||!this.selectedMission);if(!record||record.kind==='unavailable')return;
  const state=this.craftStates.find(c=>c.missionId===record.missionId),center=this.snapshot.bodies.find(b=>b.id===record.centerBodyId);text('space-craft-name',record.label);text('space-craft-state',state?`${quality[record.quality]??record.quality} · ${utc(state.epochMs)}`:'所选时刻无覆盖；位置标记已隐藏，未作外推');
  const observing=this.navigation.spacecraftViewMode==='observe',following=this.navigation.spacecraftViewMode==='follow',orbit=this.navigation.view.mode==='orbit';
  const viewStatus=record.kind==='surface-site'?'历史地点标记，不是正在飞行的航天器。':!state?'超出星历覆盖，未外推位置。':!orbit?'自由视图：相机未跟随航天器；中键拖动恢复当前观察方式。':observing?'轨道观察：相机跟随中心天体，航天器沿轨迹运动。':'跟随航天器：它会固定在画面中，轨道相对移动。';
  text('space-craft-view-status',viewStatus+` 模拟时间：${utc(this.snapshot.date.getTime())} · ${this.clock.speed===0?'已暂停':spaceTimeText(this.clock.speed)}`);
  $('space-craft-observe').hidden=record.kind!=='ephemeris';$('space-craft-observe').toggleAttribute('disabled',!state);$('space-craft-observe').setAttribute('aria-pressed',String(observing&&orbit));$('space-craft-center').setAttribute('aria-pressed',String(following&&orbit));
  $('space-craft-center').toggleAttribute('disabled',!state);$('space-craft-path').toggleAttribute('disabled',record.kind!=='ephemeris');$('space-craft-path').setAttribute('aria-pressed',String(this.trajectoryVisible));text('space-craft-path',this.trajectoryVisible?'隐藏轨迹':'显示轨迹');
  const fields:Array<[string,string]>=[['坐标原点',center?.name??record.centerBodyId],['数据类型',record.kind==='surface-site'?'历史着陆点，非当前巡视位置':quality[record.quality]??record.quality]];
  if(record.kind==='ephemeris')fields.push(['覆盖开始',utc(record.startMs)],['覆盖结束',utc(record.endMs)],['插值检验最大误差',`${record.maxInterpolationErrorKm.toPrecision(3)} km（不含源星历误差）`]);
  else fields.push(['纬度 / 东经',`${record.latitudeDeg}° / ${record.longitudeDeg}°`],['资料日期锚点',utc(record.siteEpochMs)]);
  if(state){fields.push(['距中心',formatDistance(Math.hypot(...state.relativePositionAU))],['相对位置 X/Y/Z (km，场景Y向上)',state.relativePositionAU.map(v=>(v*AU_KM).toPrecision(7)).join(' / ')]);if(state.velocityAUPerSecond)fields.push(['相对速度',`${(Math.hypot(...state.velocityAUPerSecond)*AU_KM).toFixed(4)} km/s`]);}
  this.updateFacts('space-craft-facts',fields);
  text('space-craft-note',record.notes+' 标记大小仅为定位符号，非航天器实际尺寸；位置按场景中心天体对齐。轨迹为中心共动坐标的有界采样曲线，不是实时遥测或无误差导航产品。');const source=$<HTMLAnchorElement>('space-craft-source');patchAttribute(source,'href',record.sourceUrl);
  const time=$<HTMLInputElement>('space-craft-time');if(document.activeElement!==time){const value=this.snapshot.date.toISOString().slice(0,19);if(time.value!==value)time.value=value;}
 }
 private body(t:Target|undefined):t is SpaceBody{return !!t&&'radiusKm' in t;}
 private target(id=this.navigation.view.selectedId):Target|undefined{return this.snapshot.bodies.find(t=>t.id===id)||(id?this.starTargets.get(id):undefined);}
 private save(){try{localStorage.setItem('galaxy-space-v1',JSON.stringify(this.options));}catch{}}
 private toast(message:string){text('space-toast',message);$('space-toast').hidden=false;clearTimeout(this.toastTimer);this.toastTimer=window.setTimeout(()=>$('space-toast').hidden=true,4500);}
 private dialogOpen(id:string){if(document.querySelector('dialog[open]'))return;this.clearInput();this.priorFocus=document.activeElement as HTMLElement;$<HTMLDialogElement>(id).showModal();}
 private dialogClose(d:HTMLDialogElement){d.close();this.priorFocus?.focus();this.priorFocus=null;}
 private bindUI(){
  const spacecraftRoot=$('spacecraft-library');if(spacecraftRoot)this.spacecraftLibrary=new SpacecraftLibrary(spacecraftRoot,spacecraftData as SpacecraftData,{showPosition:(id,period)=>this.showCraft(id,period),requestPositions:()=>void this.loadTrajectories()});
  const trajectoryRoot=$('spacecraft-overlay');if(trajectoryRoot)this.trajectoryOverlay=new TrajectoryOverlay(trajectoryRoot,(id:string)=>this.showCraft(id,false));
  this.bindTrajectoryUI();
  const openSpacecraft=(body='all')=>{if(this.disposed||!this.spacecraftLibrary||document.querySelector('dialog[open]'))return;this.spacecraftLibrary.reset(body);this.dialogOpen('space-spacecraft-dialog');$('space-spacecraft-dialog').scrollTop=0;this.spacecraftLibrary.focus();this.updateTrajectoryUI();void this.loadTrajectories();};
  const spacecraftButton=$('space-spacecraft'),relatedSpacecraft=$('space-related-spacecraft'),spacecraftDialog=$<HTMLDialogElement>('space-spacecraft-dialog');
  if(spacecraftButton)this.listen(spacecraftButton,'click',()=>openSpacecraft());
  if(relatedSpacecraft)this.listen(relatedSpacecraft,'click',()=>openSpacecraft(this.navigation.view.selectedId??'all'));
  if(spacecraftDialog)this.listen(spacecraftDialog,'cancel',e=>{e.preventDefault();this.dialogClose(spacecraftDialog);});
  document.querySelector<HTMLAnchorElement>('.brand')!.onclick=e=>{e.preventDefault();$('space-earth').click();};
  $('space-objects').onclick=()=>this.dialogOpen('space-objects-dialog');$('space-about').onclick=()=>this.dialogOpen('space-about-dialog');$('space-help').onclick=()=>this.dialogOpen('space-help-dialog');
  document.querySelectorAll<HTMLButtonElement>('[data-space-close]').forEach(b=>b.onclick=()=>this.dialogClose(b.closest('dialog')!));
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach(d=>{this.listen(d,'cancel',()=>this.clearInput());this.listen(d,'click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect(),m=e as MouseEvent;if(m.clientX<r.left||m.clientX>r.right||m.clientY<r.top||m.clientY>r.bottom)this.dialogClose(d);});});
  $('space-mode').onclick=()=>{this.navigation.setMode(this.navigation.view.mode==='orbit'?'free':'orbit');this.updateUI();};
  $('space-label-toggle').onclick=()=>{this.options.labels=!this.options.labels;this.save();this.updateUI();};
  $('space-earth').onclick=()=>{this.selectedMission=null;this.navigation.resetEarth();this.panel=false;$<HTMLInputElement>('space-speed').value='0';text('space-speed-factor','自动 ×1');this.updateUI();};
  $('space-system').onclick=()=>{this.selectedMission=null;this.navigation.frameSystem();this.panel=false;this.updateUI();};
  $('space-nearer').onclick=()=>this.navigation.dolly(.8);$('space-farther').onclick=()=>this.navigation.dolly(1.25);
  $('space-object-close').onclick=()=>{this.panel=false;this.updateUI();};$('space-go').onclick=()=>{const id=this.navigation.view.selectedId;if(id)this.select(id,true);};
  $('space-pause').onclick=()=>{this.clock.togglePause();this.dirty=true;this.updateUI();};
  $('space-forward').onclick=()=>{this.clock.setSpeed(nextSpaceTimeSpeed(this.clock.speed,1));this.dirty=true;this.updateUI();};$('space-rewind').onclick=()=>{this.clock.setSpeed(nextSpaceTimeSpeed(this.clock.speed,-1));this.dirty=true;this.updateUI();};$('space-now').onclick=()=>{this.clock.now();this.dirty=true;this.updateUI();};
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
  const release=(id:number)=>{this.points.delete(id);if(this.canvas.hasPointerCapture?.(id))this.canvas.releasePointerCapture(id);if(!this.points.size){this.travel=0;this.multi=false;}};
  this.listen(this.canvas,'pointerdown',event=>{
   const e=event as PointerEvent,type=e.pointerType||'mouse',mouse=type==='mouse';
   if(document.querySelector('dialog[open]')||(mouse?e.button!==0&&e.button!==1:e.button!==0))return;
   // Only same-kind touch contacts combine into a pinch; mouse chords keep the
   // original pointer/button owner and never activate a second gesture.
   if(this.points.has(e.pointerId)||this.points.size&&(type!=='touch'||[...this.points.values()].some(p=>p.pointerType!=='touch')))return;
   if(mouse)e.preventDefault();
   this.canvas.focus();this.canvas.setPointerCapture?.(e.pointerId);
   this.points.set(e.pointerId,{x:e.clientX,y:e.clientY,pointerType:type,button:e.button});this.navigation.stop();
   if(this.points.size===1){this.travel=0;this.multi=false;}else this.multi=true;
  });
  this.listen(this.canvas,'pointermove',event=>{
   const e=event as PointerEvent,old=this.points.get(e.pointerId);if(!old)return;
   if(old.pointerType==='mouse'&&(e.buttons&(old.button===1?4:1))===0){release(e.pointerId);return;}
   const before=this.pinch();this.points.set(e.pointerId,{...old,x:e.clientX,y:e.clientY});const dx=e.clientX-old.x,dy=e.clientY-old.y;this.travel+=Math.hypot(dx,dy);if(this.travel>=4)this.labelDragUntil=performance.now()+150;
   if(this.points.size===2){const after=this.pinch();if(before>0&&after>0)this.navigation.dolly(before/after);}
   else if(this.points.size===1&&this.travel>=4){
    if(old.pointerType==='mouse'){e.preventDefault();if(old.button===0)this.navigation.look(dx,dy,this.canvas.clientWidth,this.canvas.clientHeight);else this.navigation.orbit(dx,dy,this.canvas.clientWidth,this.canvas.clientHeight);}
    else if(this.navigation.view.mode==='orbit')this.navigation.orbit(dx,dy,this.canvas.clientWidth,this.canvas.clientHeight);else this.navigation.look(dx,dy,this.canvas.clientWidth,this.canvas.clientHeight);
   }
  });
  const end=(event:Event)=>{const e=event as PointerEvent,old=this.points.get(e.pointerId);if(!old)return;const pick=e.type==='pointerup'&&old.button===0&&e.button===0&&this.points.size===1&&!this.multi&&this.travel<4;release(e.pointerId);if(pick&&this.ready){const id=this.renderer.pick(e.clientX,e.clientY,this.snapshot,this.navigation.view);if(id)this.select(id,false);}};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(this.canvas,type,end);
  // pointerdown cancellation is not enough in every browser: cancel the
  // canvas's middle compatibility events too, never document-wide link clicks.
  this.listen(this.canvas,'mousedown',event=>{const e=event as MouseEvent;if(e.button===1)e.preventDefault();});
  this.listen(this.canvas,'auxclick',event=>{const e=event as MouseEvent;if(e.button===1){e.preventDefault();}});
  this.listen(this.canvas,'wheel',event=>{const e=event as WheelEvent;e.preventDefault();this.navigation.dolly(Math.exp(clamp(e.deltaY,-200,200)*.002));},{passive:false});
 }
 private clearInput(){this.keys.clear();this.pad.clear();const ids=[...this.points.keys()];this.points.clear();for(const id of ids)if(this.canvas.hasPointerCapture?.(id))this.canvas.releasePointerCapture(id);this.travel=0;this.multi=false;this.labelDragUntil=0;}
 private pinch(){const p=[...this.points.values()];return p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0;}
 private select(id:string,fly:boolean){if(id.startsWith('craft:')){this.showCraft(id.slice(6),false,fly);return;}if(!this.target(id))return;this.selectedMission=null;this.navigation.selectTarget(id,fly);this.panel=true;this.hideSearch();this.updateUI();}
 private hideSearch(){$('space-results').hidden=true;$('space-search').setAttribute('aria-expanded','false');}
 private search(query:string){const q=query.trim().toLocaleLowerCase(),root=$('space-results');root.replaceChildren();if(!q){this.hideSearch();return;}const match=(t:Target)=>[t.name,this.body(t)?t.nameEn:t.nameZh||'',t.id,...(!this.body(t)&&getStellarModel(t)?.hipNumber?[`HIP ${getStellarModel(t)!.hipNumber}`]:[])].some(s=>s.toLocaleLowerCase().includes(q));const targets:Target[]=[...this.snapshot.bodies.filter(match),...this.catalog.stars.filter(match)].slice(0,12);
  for(const t of targets){const b=button('',()=>this.select(t.id,true)),n=document.createElement('span'),s=document.createElement('small');n.textContent=this.body(t)?t.name:t.nameZh||t.name;s.textContent=this.body(t)?t.kind==='moon'?'卫星':t.id==='sun'?'恒星':'行星':`${t.distancePc.toFixed(2)} pc · 目录星`;b.append(n,s);b.dataset.target=t.id;root.appendChild(b);}if(!targets.length){const e=document.createElement('div');e.className='search-empty';e.textContent='没有匹配，试试“地球”“土星”或“Sirius”';root.appendChild(e);}root.hidden=false;$('space-search').setAttribute('aria-expanded','true');
 }
 private populateBodies(){const root=$('space-body-list');root.replaceChildren();for(const id of BODY_ORDER){const t=this.snapshot.bodies.find(b=>b.id===id);if(!t)continue;const b=button('',()=>{this.dialogClose($('space-objects-dialog'));this.select(id,true);}),dot=document.createElement('span'),n=document.createElement('span'),s=document.createElement('small');dot.className='body-dot';dot.style.background=dot.style.color=t.color;n.textContent=t.name;s.textContent='前往 ↗';b.dataset.spaceBody=id;b.append(dot,n,s);root.appendChild(b);}}
 private buildLabels(){const root=$('space-labels');root.removeAttribute('aria-hidden');for(const body of this.snapshot.bodies){const b=button(body.name,()=>this.select(body.id,false));b.className='space-label';b.hidden=true;b.tabIndex=-1;b.dataset.target=body.id;b.dataset.kind=body.kind;const kind=body.kind==='star'?'恒星':body.kind==='moon'?'天然卫星':'行星';b.title=`${body.name} · ${kind}`;b.setAttribute('aria-label',`${body.name}，${kind}，选择并查看信息`);root.appendChild(b);this.labels.set(body.id,b);this.bodyNameUnits.set(body.id,nameUnits(body.name));}
  this.starLabels=new StarLabels(root,this.catalog.stars,id=>this.select(id,false));
 }
 private updateLabels(now:number){
  const c=this.navigation.camera,selectedId=this.navigation.view.selectedId;
  const labelWidth=this.canvas.clientWidth,labelHeight=this.canvas.clientHeight;
  // Batch cached UI reads before ANY moving-label writes. Membership can wait
  // 150 ms; displayed positions, collisions and visibility never wait a frame.
  const obstacles=this.options.labels?this.starLabels?.readObstacles(now,labelWidth,labelHeight)??[]:[];
  const bodyLabels:LabelRect[]=[];
  for(const b of this.snapshot.bodies){const label=this.labels.get(b.id)!,p=this.renderer.project(b.positionAU,c);patchHidden(label,!this.options.labels||!p.visible);if(!label.hidden){label.style.transform=`translate(${p.x}px,${p.y}px) translate(8px,-50%)`;if(label.dataset.selected!==String(b.id===selectedId))label.dataset.selected=String(b.id===selectedId);bodyLabels.push({x:p.x+8,y:p.y-11,width:labelNameWidth(this.bodyNameUnits.get(b.id)!,labelWidth),height:22});}}
  this.starLabels?.update({camera:c,snapshot:this.snapshot,width:labelWidth,height:labelHeight,now,selectedId,enabled:this.options.labels,bodyLabels,obstacles,stellarFrames:this.renderer.getStellarFrames?.()??[],interacting:now<this.labelDragUntil||(this.points.size>0&&this.travel>=4)});
  const t=this.target(),marker=$('space-crosshair');if(!t){marker.hidden=true;return;}
  const p=this.renderer.project(t.positionAU,c);
  const forward=spaceCameraBasis(c).forward;
  const depth=t.positionAU.reduce((sum,value,i)=>sum+(value-c.positionAU[i])*forward[i],0);
  const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
  const size=focusSizeCssPixels(this.body(t)?t.radiusKm:getStellarModel(t)?.radiusKm??null,p.distanceAU,c.fovDeg,width,height);
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
 private updateUI(){const view=this.navigation.view,t=this.target(),body=this.body(t)?t:null,info=this.navigation.getSelectedInfo(),stellar=t&&!this.body(t)?getStellarModel(t):null;
  const layoutKey=[this.panel,t?.id??'',this.selectedMission??'',this.options.labels].join('/');if(layoutKey!==this.uiLayoutKey){this.uiLayoutKey=layoutKey;this.starLabels?.invalidateLayout();}
  const craft=this.craftStates.find(c=>`craft:${c.missionId}`===view.selectedId),mission=this.selectedMission?spacecraftData.records.find(r=>r.id===this.selectedMission):undefined;
  const distance=info?.distanceAU??Math.hypot(...view.camera.positionAU);text('space-mode-readout',view.mode==='orbit'?craft?this.navigation.spacecraftViewMode==='observe'?'轨道观察':'跟随航天器':'环绕模式':'自由飞行');text('space-mode-label',view.mode==='orbit'?'自由飞行':'环绕目标');$('space-mode').setAttribute('aria-pressed',String(view.mode==='free'));
  const name=mission?mission.name:t?(body?t.name:(t as CatalogStar3D).nameZh||t.name):'太阳系';text('space-range',craft?`距${name} ${formatDistance(distance)}`:t?`距${name} ${formatDistance(distance)}`:`距太阳 ${formatDistance(distance)}`);text('space-speed-readout',formatSpeed(view.speedAUPerSecond));text('space-time-speed',spaceTimeText(this.clock.speed));$('space-time-speed').title=spaceTimeDescription(this.clock.speed);$('space-time-speed').setAttribute('aria-label',spaceTimeDescription(this.clock.speed));text('space-pause',this.clock.speed?'Ⅱ':'▷');$('space-pause').setAttribute('aria-label',this.clock.speed?'暂停时间':'继续时间');
  $('space-label-toggle').setAttribute('aria-pressed',String(this.options.labels));text('journey-title',name==='地球'?'我们的蓝色星球':name);text('journey-kind',mission?'航天器 · 有来源的位置与轨迹':t&&!body?'恒星目录 · 三维空间':'太阳系 · 三维空间');text('journey-subtitle',view.mode==='orbit'?'中键拖动环绕 · 左键拖动浏览星空 · 滚轮靠近':'左键拖动浏览星空 · 中键环绕目标 · WASD / QE 飞行');
  const modelNote=$('journey-model-note');if(modelNote){modelNote.hidden=!t;if(t)text('journey-model-note',surfaceEvidence(t.id,!body));}
  const related=$('space-related-spacecraft');if(related){const n=t?this.spacecraftLibrary?.relatedCount(t.id)??0:0;related.hidden=!this.panel||!t||!n;if(n)text('space-related-spacecraft',`相关航天器 · ${n}`);}
  $('space-object').hidden=!this.panel||!t;document.body.classList.toggle('object-open',this.panel&&!!t||!!mission);this.observationPanel?.show(t?.id??'',this.panel&&!!t);
  if(this.panel&&t){text('space-object-name',name);text('space-object-english',body?body.nameEn:t.name);text('space-object-kind',body?(body.id==='sun'?'恒星':body.kind==='moon'?'天然卫星':'行星'):'目录恒星 · 固定历元');const rows:Array<[string,string]>=[['相机距离',formatDistance(distance)]];
   if(body){rows.push(['半径',`${body.radiusKm.toLocaleString()} km`]);if(info?.illuminatedFraction!==null&&info?.illuminatedFraction!==undefined&&body.id!=='sun')rows.push(['相位受光估计',`${(info.illuminatedFraction*100).toFixed(1)}%`]);rows.push(['当前空间位置','日心 J2000']);}
   else {const s=t as CatalogStar3D;rows.push(['目录距太阳',`${s.distancePc.toFixed(3)} pc`],['绝对目视星等',s.absoluteMagnitude.toFixed(2)],['HYG 编号',s.sourceId]);
    if(stellar){const approximate=(value:number)=>Number(value.toPrecision(3)).toLocaleString('zh-CN',{maximumSignificantDigits:3});
     if(stellar.hipNumber)rows.push(['HIP 编号',String(stellar.hipNumber)]);
     rows.push(['光谱型（HYG目录）',stellar.spectralType||'未提供'],['类别',stellar.classification],
      [`有效温度（${stellar.estimatedTemperature?'估算':'参考'}）`,`${approximate(stellar.temperatureK)} K`],
      [`半径（${stellar.estimatedRadius?'估算':'参考'}）`,`${approximate(stellar.radiusKm/695700)} R☉`],
      [`光度（${stellar.estimatedLuminosity?'估算':'参考'}）`,`${approximate(stellar.luminositySolar)} L☉`]);
     if(info?.altitudeAU!==null&&info?.altitudeAU!==undefined)rows.push(['距模型表面',formatDistance(info.altitudeAU)]);
    }
   }
   this.updateFacts('space-facts',rows);
   const map=body?observationMap(body.id):undefined;
   text('space-object-note',body?`${surfaceEvidence(body.id)}。${map?`${map.capturedAt}；${map.processing}；${map.coverage}。`:'近景不加载未经核验的艺术贴图。'}${body.id==='saturn'?'土星环仅环几何示意，非实拍径向纹理。':''}真实半径与近似星历；大气/曝光/光照仍是可视化近似，不是实时天气。`:stellar?`未提供真实恒星表面影像；不生成颗粒、斑点；不生成虚构行星系统。光滑球体仅用于尺寸/颜色示意，不代表已知表面状况。${stellar.temperatureSource}；${stellar.radiusSource}；${stellar.luminositySource}。固定 J2000 目录，不模拟真实自转/活动。`:'位置与距离来自固定J2000目录；未提供真实恒星表面影像，不生成虚构表面或行星系统。');
  }
  const sources=$('space-stellar-sources');if(sources){sources.hidden=!stellar;const sourceId=stellar&&t?t.id:'';if(sourceId!==this.stellarSourcesId){sources.replaceChildren();this.stellarSourcesId=sourceId;if(stellar)for(const [i,url] of stellar.references.slice(0,6).entries()){if(!/^https?:\/\//.test(url))continue;const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`资料 ${i+1}`;sources.append(a,document.createTextNode(' · '));}}}
  this.updateTrajectoryUI();
  const stats=this.renderer.getStats();text('space-status',`${this.catalog.stars.length.toLocaleString()} 三维目录星 · ${stats.status||'太阳系真实尺度'}${this.catalog.warning?' · 星表降级':''}`);$('space-status').title='三维位置与可视化显示，不是完整宇宙动力学模拟';document.body.dataset.spaceMode=view.mode;
 }
 private loop=(now:number)=>{if(this.disposed)return;try{const dt=clamp((now-this.lastFrame)/1000,0,.1);this.lastFrame=now;if(document.hidden){this.raf=requestAnimationFrame(this.loop);return;}const date=this.clock.tick(dt);
  if(this.dirty||date.getTime()!==this.snapshot.date.getTime()&&now-this.lastScience>=Math.max(16,Math.min(250,1500/Math.max(1,Math.abs(this.clock.speed))))){this.snapshot=computeSpace(date);this.syncCraftStates();this.navigation.setSnapshot(this.snapshot,this.craftTargets);this.lastScience=now;this.dirty=false;}
  if(!document.querySelector('dialog[open]')){const m:[number,number,number]=[Number(this.keys.has('KeyD'))-Number(this.keys.has('KeyA')),Number(this.keys.has('KeyE'))-Number(this.keys.has('KeyQ')),Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS'))];for(const id of this.pad.values())for(let i=0;i<3;i++)m[i]+=MOVE[id][i];if(Math.hypot(...m)>0)this.navigation.move(m,dt,this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'));}
  this.navigation.update(dt);this.renderer.render(this.snapshot,this.navigation.view,this.options,now);this.updateLabels(now);this.renderTrajectories(now);if(now-this.lastUI>150){this.updateUI();this.lastUI=now;}this.raf=requestAnimationFrame(this.loop);
 }catch(error){this.fail(error instanceof Error?error.message:String(error));}};
 fail(message:string){if(this.disposed)return;this.dispose();$('space-loading').hidden=false;text('space-loading-text',message);$('space-loading').querySelector('h2')!.textContent='暂时无法进入三维空间';$('space-retry').hidden=false;document.body.dataset.spaceReady='error';this.clearInput();console.error(message);this.canvas.dispatchEvent(new CustomEvent('galaxy-mode-error',{bubbles:true}));}
 dispose(){if(this.disposed)return;this.disposed=true;this.ready=false;this.loadAbort.abort();this.trajectoryRequest?.abort();clearTimeout(this.trajectoryTimer);this.trajectoryTimer=0;cancelAnimationFrame(this.raf);clearTimeout(this.toastTimer);this.clearInput();for(const fn of this.cleanups)fn();this.cleanups=[];
  if((window as any).__space===this.debug)delete (window as any).__space;this.debug=undefined;
  if(this.canvas.isConnected){delete document.body.dataset.spaceReady;delete document.body.dataset.spaceMode;document.body.classList.remove('object-open');}
  this.observationPanel?.dispose();this.observationPanel=undefined;for(const list of this.facts.values())list.dispose();this.facts.clear();
  this.trajectoryOverlay?.dispose();this.trajectoryOverlay=undefined;this.trajectoryData=undefined;this.trajectoryFrames.clear();this.craftStates=[];this.craftTargets=[];this.selectedMission=null;
  this.spacecraftLibrary?.dispose();this.spacecraftLibrary=undefined;const spacecraftDialog=$<HTMLDialogElement>('space-spacecraft-dialog');if(spacecraftDialog?.open)spacecraftDialog.close();this.priorFocus=null;
  for(const label of this.labels.values()){label.onclick=null;label.remove();}this.labels.clear();this.bodyNameUnits.clear();this.starLabels?.dispose();this.starLabels=undefined;this.starTargets.clear();this.focusTickElements.clear();this.navigation.dispose();disposeRenderer(this.renderer);
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
