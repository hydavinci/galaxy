import {fileURLToPath} from 'node:url';
// Deterministic DOM/application RAF integration; real astronomy, controller and
// projection math, but a recording renderer (NOT browser/GPU/FPS acceptance).
// OVERLAY_BASELINE_ROOT optionally runs the same 60/120Hz probes against an
// immutable former release. No production bundles or files are written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { apparentDirection, equatorialDirection, projectDirection, transformDirection } from '../src/observer/sky-renderer';
import type { Vec3 } from '../src/observer/types';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceRoot=process.env.OVERLAY_BASELINE_ROOT||root;
const baseline=Boolean(process.env.OVERLAY_BASELINE_ROOT);
const normalize=(v:Vec3)=>v.map(x=>x/Math.hypot(...v)) as Vec3;
let bundled:Promise<string>|undefined;
function bundle(){return bundled??=build({absWorkingDir:sourceRoot,entryPoints:['src/observer/app.ts'],bundle:true,write:false,format:'iife',globalName:'OverlayFixture',platform:'browser',target:'es2020',loader:{'.css':'empty'},plugins:[{name:'record-render-frame',setup(b){
 b.onResolve({filter:/sky-renderer$/},()=>({path:'sky-renderer',namespace:'record'}));
 b.onLoad({filter:/.*/,namespace:'record'},()=>({loader:'js',resolveDir:sourceRoot,contents:`
 import { apparentDirection, equatorialDirection, projectDirection, transformDirection } from '${sourceRoot}src/observer/sky-renderer.ts';
 export * from '${sourceRoot}src/observer/sky-renderer.ts';
 export class SkyRenderer {
  constructor(canvas){this.canvas=canvas} async init(){} getStats(){return {catalogCount:115517,hipsTiles:12,hipsLoading:0,fps:0,status:'recording only'}}
  render(state,camera,settings){window.__draw={state,camera:{...camera},settings:{...settings},width:this.canvas.clientWidth,height:this.canvas.clientHeight};}
  projectEquatorial(ra,dec,state,camera,refraction){const h=transformDirection(state.equatorialToHorizontal,equatorialDirection(ra,dec)),n=Math.hypot(...h);return projectDirection(apparentDirection(h.map(x=>x/n),refraction),camera,this.canvas.clientWidth,this.canvas.clientHeight);}
 }
 `}));
}}]}).then(r=>r.outputFiles[0].text);}
type Metrics={cssReads:number;rectReads:number;dimensionReads:number;overlayWrites:number;visibilityWrites:number;sortSizes:number[];events:string[]};
async function setup(width=1440,height=900,dpr=1){
 const window=new Window({url:'http://localhost/',width,height}),doc=window.document;
 doc.write((await readFile(root+'tests/fixtures/observer.html','utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
 const style=doc.createElement('style');style.textContent=await readFile(sourceRoot+'src/observer/style.css','utf8');doc.head.appendChild(style);
 const named=JSON.parse(await readFile(root+'public/data/named-stars.json','utf8'));
 window.fetch=(async()=>({ok:true,json:async()=>named})) as any;
 let now=1000,wall=Date.parse('2026-10-14T00:24:00Z'),raf:FrameRequestCallback|undefined;
 const originalNow=Object.getOwnPropertyDescriptor(window.performance,'now'),originalDateNow=window.Date.now;
 Object.defineProperty(window.performance,'now',{value:()=>now,configurable:true});window.Date.now=()=>wall;
 window.requestAnimationFrame=((fn:FrameRequestCallback)=>{raf=fn;return 1;}) as any;window.cancelAnimationFrame=()=>{};
 Object.defineProperty(window,'devicePixelRatio',{value:dpr});Object.defineProperty(doc,'hidden',{value:false,configurable:true});
 const resizeObservers:{callback:()=>void;nodes:Set<any>}[]=[];
 window.ResizeObserver=class {
  entry:{callback:()=>void;nodes:Set<any>};constructor(callback:()=>void){this.entry={callback,nodes:new Set()};resizeObservers.push(this.entry);}
  observe(node:any){this.entry.nodes.add(node);}unobserve(node:any){this.entry.nodes.delete(node);}disconnect(){this.entry.nodes.clear();}
 } as any;
 const resizedElement=(node:any)=>{for(const observer of resizeObservers)if(observer.nodes.has(node))observer.callback();};
 const metrics:Metrics={cssReads:0,rectReads:0,dimensionReads:0,overlayWrites:0,visibilityWrites:0,sortSizes:[],events:[]};
 const el=(id:string)=>doc.getElementById(id) as any,canvas=el('sky');
 for(const [key,get]of [['clientWidth',()=>width],['clientHeight',()=>height]] as const)Object.defineProperty(canvas,key,{get(){metrics.dimensionReads++;metrics.events.push('read:canvas');return get();},configurable:true});
 canvas.width=width*dpr;canvas.height=height*dpr;
 const captured=new Set<number>();canvas.setPointerCapture=(id:number)=>captured.add(id);canvas.hasPointerCapture=(id:number)=>captured.has(id);canvas.releasePointerCapture=(id:number)=>captured.delete(id);
 const computed=window.getComputedStyle.bind(window);window.getComputedStyle=((node:any)=>{metrics.cssReads++;metrics.events.push('read:style');return computed(node);}) as any;
 const rects=new Map<any,{x:number;y:number;width:number;height:number}>();
 for(const node of doc.querySelectorAll<any>('.topbar,.object-panel,.toolbar')){
  const rect=node.classList.contains('topbar')?{x:0,y:0,width,height:85}:node.classList.contains('toolbar')?{x:width/2-250,y:height-85,width:500,height:65}:{x:width-320,y:110,width:290,height:400};rects.set(node,rect);
  node.getBoundingClientRect=()=>{metrics.rectReads++;metrics.events.push('read:rect');const r=rects.get(node)!;return {...r,left:r.x,right:r.x+r.width,top:r.y,bottom:r.y+r.height};};
 }
 window.eval((await bundle())+';window.OverlayFixture=OverlayFixture;');
 // Count application Array.sort sizes in this isolated realm, not test sorting.
 (window as any).__sortSizes=metrics.sortSizes;window.eval('const originalSort=Array.prototype.sort;Array.prototype.sort=function(...args){window.__sortSizes.push(this.length);return originalSort.apply(this,args)};');
 const app=new (window as any).OverlayFixture.ObserverApp();await app.init();
 // Happy DOM CSS setters delegate through setProperty (a Proxy, not native
 // accessor descriptors). Count attempted writes, including redundant values.
 for(const node of [...doc.querySelectorAll<any>('.sky-label'),el('selection-marker')]){
  const set=node.style.setProperty.bind(node.style);
  node.style.setProperty=(key:string,value:string,priority?:string)=>{metrics.overlayWrites++;metrics.events.push('write:overlay');set(key,value,priority);};
  const setAttribute=node.setAttribute.bind(node),removeAttribute=node.removeAttribute.bind(node);
  node.setAttribute=(key:string,value:string)=>{if(key==='hidden'){metrics.visibilityWrites++;metrics.events.push('write:overlay');}setAttribute(key,value);};
  node.removeAttribute=(key:string)=>{if(key==='hidden'){metrics.visibilityWrites++;metrics.events.push('write:overlay');}removeAttribute(key);};
 }
 const reset=()=>{metrics.cssReads=metrics.rectReads=metrics.dimensionReads=metrics.overlayWrites=metrics.visibilityWrites=0;metrics.sortSizes.length=metrics.events.length=0;};
 const tick=(ms=1000/60)=>{metrics.events.length=0;now+=ms;wall+=ms;const fn=raf;raf=undefined;assert.ok(fn,'RAF remains scheduled');fn(now);assert.equal(doc.body.dataset.ready,'true',el('loading-text').textContent);return (window as any).__draw;};
 const pointer=(type:string,id:number,x:number,y=height/2)=>canvas.dispatchEvent(new window.PointerEvent(type,{pointerId:id,button:0,clientX:x,clientY:y,bubbles:true}));
 const search=(query:string)=>{el('search').value=query;el('search').dispatchEvent(new window.Event('input'));const item=el('search-results').querySelector('button');assert.ok(item,query);item.click();};
 const settle=(hz=60,seconds=4)=>{for(let i=0;i<hz*seconds;i++)tick(1000/hz);};
 const resize=(w:number,h:number)=>{width=w;height=h;window.innerWidth=w;window.innerHeight=h;window.dispatchEvent(new window.Event('resize'));};
 tick();return {window,doc,el,app,metrics,reset,tick,pointer,search,settle,resize,resizedElement,rects,get draw(){return (window as any).__draw;},close:()=>{if(originalNow)Object.defineProperty(window.performance,'now',originalNow);else delete (window.performance as any).now;window.Date.now=originalDateNow;return window.happyDOM.abort();}};
}
type Fixture=Awaited<ReturnType<typeof setup>>;
function coordinates(el:any){
 // New compositor transform preserves the old label (7px,-50%) and marker/
 // constellation (-50%,-50%) optical anchor. Old releases use left/top.
 const m=/^translate\(([-+\deE.]+)px,\s*([-+\deE.]+)px\)/.exec(el.style.transform);
 return m?{x:Number(m[1]),y:Number(m[2])}:{x:parseFloat(el.style.left),y:parseFloat(el.style.top)};
}
function projected(f:Fixture,target:any){
 const {state,camera,settings,width,height}=f.draw;
 const body=target.kind==='body'?state.bodies.find((b:any)=>b.id===target.id):null;
 const eq=target.kind==='star'?f.app.stars.find((s:any)=>s.id===target.id):target.kind==='constellation'?f.app.constellationCenter(target.id):null;
 const direction=body?body.direction:normalize(transformDirection(state.equatorialToHorizontal,equatorialDirection(eq.raRad,eq.decRad)));
 return projectDirection(apparentDirection(direction,settings.refraction),camera,width,height);
}
function errors(f:Fixture){
 const values:{kind:string;error:number}[]=[];
 for(const [id,node]of f.app.namedLabels){if(node.hidden)continue;const kind=id.startsWith('star-')?'star':'body',p=projected(f,{kind,id}),q=coordinates(node);values.push({kind,error:Math.hypot(p.x-q.x,p.y-q.y)});}
 for(const [id,node]of f.app.constellationLabels){if(node.hidden)continue;const p=projected(f,{kind:'constellation',id}),q=coordinates(node);values.push({kind:'constellation',error:Math.hypot(p.x-q.x,p.y-q.y)});}
 if(f.app.selected&&!f.el('selection-marker').hidden){const p=projected(f,f.app.selected),q=coordinates(f.el('selection-marker'));values.push({kind:'marker',error:Math.hypot(p.x-q.x,p.y-q.y)});}
 return values;
}
function checkFrame(f:Fixture,records:Record<string,number>,phase:string){
 const values=errors(f);
 if(!baseline&&f.app.selected)assert.equal(f.el('selection-marker').hidden,!projected(f,f.app.selected).visible,`${phase}: marker visibility follows this frame`);
 for(const {kind,error}of values){assert.ok(Number.isFinite(error));records[phase+':'+kind]=Math.max(records[phase+':'+kind]||0,error);if(!baseline)assert.ok(error<1e-6,`${phase} ${kind} mismatch ${error} CSS px`);}
 assert.ok([...f.app.namedLabels.values()].filter((n:any)=>!n.hidden).length<=18,'existing named-label budget');
}

for(const hz of [60,120])for(const dpr of [1,2])test(`overlay/frame ${hz}Hz DPR${dpr}: drag, inertia, wheel, goto and live 1x`,async t=>{
 const f=await setup(1440,900,dpr),record:Record<string,number>={};try{
  f.app.clock.setDate(new f.window.Date('2026-10-14T00:24:00Z'));f.tick(1000/hz);f.search('织女');f.settle(hz);f.app.setTracking(false);f.app.view.camera.fovDeg=70;
  f.doc.querySelector<any>('[data-toggle="constellations"]')!.click();f.tick(1000/hz);
  f.pointer('pointerdown',1,720,450);
  for(let i=1;i<=30;i++){f.pointer('pointermove',1,720+i*2,450+i*.4);f.tick(1000/hz);checkFrame(f,record,'drag');}
  f.pointer('pointerup',1,780,462);const before={...f.app.view.camera};
  for(let i=0;i<30;i++){f.tick(1000/hz);checkFrame(f,record,'inertia');}
  assert.notEqual(f.app.view.camera.azimuthDeg,before.azimuthDeg,'inertia preserved');
  f.app.view.stop();for(let i=0;i<24;i++){f.el('sky').dispatchEvent(new f.window.WheelEvent('wheel',{deltaY:i%2?-18:12,cancelable:true}));f.tick(1000/hz);checkFrame(f,record,'wheel');}
  f.el('object-center').click();for(let i=0;i<hz*2;i++){f.tick(1000/hz);checkFrame(f,record,'goto');}
  f.app.clock.now();for(let i=0;i<hz;i++){f.tick(1000/hz);checkFrame(f,record,'live1x');}
  const total=Math.max(...Object.values(record));if(baseline)assert.ok(total>1,'former implementation must reproduce stale coordinates');
  t.diagnostic(JSON.stringify({hz,dpr,maxCssError:total,byPhase:record}));
 }finally{await f.close();}
});

for(const hz of [60,120])test(`overlay/frame ${hz}Hz: body close-up, live pinch 2→1 and re-centered marker`,async t=>{
 const f=await setup(390,844,2),record:Record<string,number>={};try{
  f.app.clock.setDate(new f.window.Date('2026-10-14T00:24:00Z'));f.tick(1000/hz);f.app.select({kind:'body',id:'neptune'},true);f.settle(hz,6);f.app.clock.now();
  f.pointer('pointerdown',11,175);f.pointer('pointerdown',12,215);
  for(let i=1;i<=12;i++){f.pointer('pointermove',12,215+i*2);f.tick(1000/hz);checkFrame(f,record,'pinch');assert.equal(f.app.tracking,true);}
  f.pointer('pointerup',12,239);f.pointer('pointermove',11,176);f.tick(1000/hz);checkFrame(f,record,'2to1-jitter');assert.equal(f.app.tracking,true);
  f.pointer('pointermove',11,182);assert.equal(f.app.tracking,false);f.tick(1000/hz);checkFrame(f,record,'2to1-pan');f.pointer('pointerup',11,182);
  for(let i=0;i<20;i++){f.tick(1000/hz);checkFrame(f,record,'close-inertia');}
  const fov=f.app.view.camera.fovDeg;f.el('object-center').click();for(let i=0;i<hz*3;i++){f.tick(1000/hz);checkFrame(f,record,'close-center');}
  assert.equal(f.app.view.camera.fovDeg,fov);assert.equal(f.app.tracking,true);assert.equal(f.app.clock.speed,1);
  t.diagnostic(JSON.stringify({hz,body:'neptune',maxCssError:Math.max(...Object.values(record)),byPhase:record}));
 }finally{await f.close();}
});

test('overlay/frame baseline counters: one second of stable paused 120Hz RAF',async t=>{
 const f=await setup();try{
  f.app.clock.setDate(new f.window.Date('2026-10-14T00:24:00Z'));f.search('织女');f.settle(120);f.app.setTracking(false);f.tick();f.reset();
  for(let i=0;i<120;i++)f.tick(1000/120);
  t.diagnostic(JSON.stringify({frames:120,...f.metrics,events:undefined}));
  if(!baseline){assert.equal(f.metrics.cssReads,0);assert.equal(f.metrics.rectReads,0);assert.ok(f.metrics.dimensionReads<=4*120,'at most one app and one render CSS-size pair per frame');assert.equal(f.metrics.overlayWrites,0,'stationary overlays do not repeat position/size writes');assert.equal(f.metrics.visibilityWrites,0,'stationary overlays do not repeat hide/show writes');assert.ok(f.metrics.sortSizes.every(n=>n<=9),'never re-sort the named catalog');}
 }finally{await f.close();}
});

for(const hz of [60,120])test(`overlay/frame ${hz}Hz: labels toggles and immersion never throttle marker or selected name`,{skip:baseline},async()=>{
 const f=await setup();try{
  f.search('织女');f.settle(hz);f.doc.querySelector<any>('[data-toggle="constellations"]')!.click();f.tick(1000/hz);
  const selected=f.app.namedLabels.get(f.app.selected.id),toggle=f.doc.querySelector<any>('[data-toggle="labels"]')!;
  assert.equal(selected.hidden,false);assert.equal(f.el('selection-marker').hidden,false);
  const nodes=[...f.el('sky-labels').children];
  toggle.click();f.tick(1000/hz);
  assert.ok([...f.el('sky-labels').children].every((node:any)=>node.hidden));assert.equal(f.el('selection-marker').hidden,false);
  f.pointer('pointerdown',71,720);for(let i=1;i<=8;i++){f.pointer('pointermove',71,720+3*i);f.tick(1000/hz);checkFrame(f,{},'labels-off-drag');}
  toggle.click();f.tick(1000/hz);assert.equal(selected.hidden,false);checkFrame(f,{},'labels-on');
  f.el('immersive').click();f.tick(1000/hz);assert.equal(selected.hidden,false);checkFrame(f,{},'immersive');
  f.el('exit-immersive').click();f.tick(1000/hz);checkFrame(f,{},'exit-immersive');f.pointer('pointerup',71,744);
  assert.deepEqual([...f.el('sky-labels').children],nodes,'overlay nodes are never replaced');
  assert.match(selected.style.transform,/translate\(7px,-50%\)$/);assert.match(f.el('selection-marker').style.transform,/translate\(-50%,-50%\)$/);
  assert.equal(f.window.getComputedStyle(selected).left,'0px');assert.equal(f.window.getComputedStyle(selected).top,'0px');assert.equal(f.window.getComputedStyle(selected).pointerEvents,'auto');
  f.el('object-close').click();f.tick(1000/hz);assert.equal(f.el('selection-marker').hidden,true);
  selected.click();assert.equal(f.app.selected.kind,'star');assert.equal(f.app.selected.id,[...f.app.namedLabels].find(([,node]:any)=>node===selected)![0],'transformed label preserves its click target');
  f.tick(1000/hz);checkFrame(f,{},'label-click');
 }finally{await f.close();}
});

test('overlay cache: resize, panel open/close, ResizeObserver and immersive changes read before every frame write', {skip:baseline},async()=>{
 const f=await setup();try{
  f.app.clock.setDate(new f.window.Date('2026-10-14T00:24:00Z'));f.search('织女');f.settle();
  const ordered=()=>{const firstWrite=f.metrics.events.findIndex(e=>e==='write:overlay'),lastRead=f.metrics.events.reduce((last,e,i)=>e.startsWith('read:')?i:last,-1);assert.ok(firstWrite<0||lastRead<firstWrite,JSON.stringify(f.metrics.events));};
  f.app.setTracking(false);f.pointer('pointerdown',31,720);f.reset();
  for(let i=1;i<=12;i++){f.metrics.events.length=0;f.pointer('pointermove',31,720+i*3);f.tick(1000/120);ordered();}
  assert.equal(f.metrics.cssReads,0);assert.equal(f.metrics.rectReads,0);assert.ok(f.metrics.overlayWrites>0,'instrumentation sees moving transforms');
  f.pointer('pointercancel',31,756);
  f.reset();f.resize(1000,700);f.tick(1000/120);assert.equal(f.metrics.rectReads,3);ordered();checkFrame(f,{},'resize');
  f.reset();f.tick(1000/120);assert.equal(f.metrics.rectReads,0);assert.equal(f.metrics.cssReads,0);
  const toolbar=f.doc.querySelector<any>('.toolbar')!;
  // Geometry changes outside the app (responsive/font/content changes) are
  // delivered by the browser's ResizeObserver, not a periodic DOM poll.
  f.rects.set(toolbar,{x:0,y:0,width:1000,height:700});f.resizedElement(toolbar);f.reset();f.tick(1000/120);assert.equal(f.metrics.rectReads,3);ordered();
  assert.equal([...f.app.namedLabels.values()].filter((n:any)=>!n.hidden).length,1,'only selected label may overlap a UI obstacle');
  assert.equal(f.app.namedLabels.get(f.app.selected.id).hidden,false,'selection bypasses collisions');
  f.reset();f.el('object-close').click();f.tick(1000/120);assert.equal(f.metrics.rectReads,2);ordered();
  f.reset();f.search('织女');f.tick(1000/120);assert.equal(f.metrics.rectReads,3);ordered();
  f.reset();f.el('immersive').click();f.tick(1000/120);assert.equal(f.metrics.rectReads,0);ordered();
  f.reset();f.el('exit-immersive').click();f.tick(1000/120);assert.equal(f.metrics.rectReads,3);ordered();
 }finally{await f.close();}
});

for(const hz of [60,120])test(`overlay/frame ${hz}Hz: selected constellation, edge visibility and hidden document resume`,{skip:baseline},async()=>{
 const f=await setup();try{
  f.search('猎户');f.settle(hz);f.doc.querySelector<any>('[data-toggle="constellations"]')!.click();f.tick(1000/hz);
  f.app.setTracking(false);f.app.view.camera.azimuthDeg+=5;
  for(let i=0;i<15;i++){f.app.view.camera.azimuthDeg+=.2;f.tick(1000/hz);checkFrame(f,{},'selected-constellation');}
  assert.ok([...f.app.constellationLabels.values()].some((node:any)=>!node.hidden),'constellation name positions were exercised');
  for(const label of f.app.constellationLabels.values())if(!label.hidden)assert.match(label.style.transform,/translate\(-50%,-50%\)$/);
  const node=f.el('selection-marker'),old=node.style.transform,draw=f.draw;
  Object.defineProperty(f.doc,'hidden',{value:true,configurable:true});f.app.view.camera.azimuthDeg+=3;f.tick(1000/hz);assert.equal(f.draw,draw);assert.equal(node.style.transform,old,'hidden document does not run partial overlay-only frames');
  Object.defineProperty(f.doc,'hidden',{value:false,configurable:true});f.doc.dispatchEvent(new f.window.Event('visibilitychange'));f.tick(1000/hz);checkFrame(f,{},'resume');assert.notEqual(node.style.transform,old);
  f.app.view.camera.azimuthDeg+=180;f.tick(1000/hz);assert.equal(node.hidden,true);assert.ok([...f.app.namedLabels.values()].filter((node:any)=>!node.hidden).every((node:any)=>Number.isFinite(coordinates(node).x)));
 }finally{await f.close();}
});

test('overlay/frame selected marker is independent of the 18-name budget; all body centers use drawn directions', {skip:baseline},async t=>{
 const f=await setup(1200,800,2);let max=0;try{
  f.app.clock.setDate(new f.window.Date('2026-10-14T00:24:00Z'));f.tick();
  for(const body of f.app.state.bodies){
   f.app.select({kind:'body',id:body.id},true);f.settle(120,5);
   // At minimum FOV avoid even small RA/Dec reconstruction differences:
   // compare with the exact direction that body rendering really receives.
   f.app.view.zoom(.0001/f.app.view.camera.fovDeg);f.tick(1000/120);assert.ok(Math.abs(f.draw.camera.fovDeg-.0001)<1e-12);
   const p=projected(f,{kind:'body',id:body.id}),q=coordinates(f.el('selection-marker'));
   max=Math.max(max,Math.hypot(p.x-q.x,p.y-q.y));assert.equal(f.el('selection-marker').hidden,false);
   const label=f.app.namedLabels.get(body.id);assert.equal(label.hidden,false);assert.deepEqual(coordinates(label),q);
   const drawnBody=f.draw.state.bodies.find((b:any)=>b.id===body.id);
   const size=Math.max(28,800*Math.tan(drawnBody.angularDiameterRad/2)/Math.tan(f.draw.camera.fovDeg*Math.PI/360)+12);
   assert.ok(Math.abs(parseFloat(f.el('selection-marker').style.width)-size)<1e-6,`${body.id}: width ${f.el('selection-marker').style.width}, expected ${size}`);assert.equal(f.el('selection-marker').style.width,f.el('selection-marker').style.height);
   f.doc.querySelector<any>('[data-toggle="labels"]')!.click();f.tick(1000/120);assert.equal(label.hidden,true);assert.equal(f.el('selection-marker').hidden,false);
   f.doc.querySelector<any>('[data-toggle="labels"]')!.click();f.tick(1000/120);
  }
  assert.equal(max,0);t.diagnostic(JSON.stringify({bodies:9,fov:.0001,dpr:2,maxCssError:max}));
 }finally{await f.close();}
});

test('overlay budget: a selected faint star with no name element retains its marker beside all 18 labels', {skip:baseline},async()=>{
 const f=await setup();try{
  const faint=f.app.stars.find((s:any)=>s.magnitude>=4);assert.ok(faint);
  f.app.select({kind:'star',id:faint.id},true);f.settle();assert.equal(f.app.namedLabels.has(faint.id),false);
  f.app.setImmersive(true);f.app.view.zoom(110/f.app.view.camera.fovDeg);
  // Deterministic noncolliding candidate layout saturates the ordinary budget;
  // marker projection continues to use the actual rendered target/camera.
  let index=0;f.app.projectOverlay=()=>{const i=index++;return {x:60+(i%8)*160,y:150+Math.floor(i/8)*70,visible:true,altitudeDeg:30,azimuthDeg:0};};
  f.tick(1000/120);
  assert.equal([...f.app.namedLabels.values()].filter((node:any)=>!node.hidden).length,18);
  assert.equal(f.el('selection-marker').hidden,false);
  const p=projected(f,f.app.selected),q=coordinates(f.el('selection-marker'));assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<1e-6);
  f.doc.querySelector<any>('[data-toggle="labels"]')!.click();f.tick(1000/120);assert.ok([...f.app.namedLabels.values()].every((node:any)=>node.hidden));assert.equal(f.el('selection-marker').hidden,false);
 }finally{await f.close();}
});
