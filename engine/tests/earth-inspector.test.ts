import {fileURLToPath} from 'node:url';
// Deterministic DOM/GL-lifecycle tests, not browser/GPU/layout acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { defaultEarthView, earthRadius, earthRotation, rotateEarth, zoomEarth, EARTH_MIN_ZOOM, EARTH_MAX_ZOOM, EARTH_TEXTURE_BUDGET } from '../src/observer/earth-inspector';

const root = fileURLToPath(new URL('../',import.meta.url));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const skyIds = ['sun','moon','mercury','venus','mars','jupiter','saturn','uranus','neptune'];
const mockRenderer = `export { apparentDirection, bodyDiskContains, equatorialDirection, projectDirection, transformDirection } from '${root}src/observer/sky-renderer.ts';
export class SkyRenderer {
 constructor(){window.__skyRenders=0;} async init(){} render(){window.__skyRenders++;}
 getStats(){return {catalogCount:115517,hipsTiles:12,hipsLoading:0,fps:60,status:'MOCK'}}
 projectEquatorial(){return {x:200,y:200,visible:true,altitudeDeg:30,azimuthDeg:180};}
 projectHorizontal(){return {x:200,y:200,visible:true,altitudeDeg:30,azimuthDeg:180};}
}`;
let bundled: Promise<string> | undefined;
function bundle() {
 return bundled ??= build({absWorkingDir:root, entryPoints:['tests/fixtures/observer-entry.ts'], bundle:true, write:false, format:'iife', platform:'browser', target:'es2020', loader:{'.css':'empty'}, plugins:[{name:'mock-sky-only',setup(b){
  b.onResolve({filter:/sky-renderer$/},()=>({path:'sky-renderer',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mockRenderer,loader:'js',resolveDir:root}));
 }}]}).then(r=>r.outputFiles[0].text);
}
class ControlledImage {
 onload: (()=>void) | null = null; onerror:(()=>void)|null=null;
 naturalWidth=0; naturalHeight=0; decoding=''; source=''; requested='';
 resolve!:()=>void; reject!:(error:Error)=>void;
 decoded=new Promise<void>((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
 set src(value:string){this.source=value;if(value)this.requested=value;}
 get src(){return this.source;}
 decode(){return this.decoded;}
 load(){const tier=Number(/(\d)k_/.exec(this.requested)![1]);this.naturalWidth=tier*1024;this.naturalHeight=tier*512;this.onload?.();}
}
function fakeGL(failCompile=false) {
 let serial=0,constant=1000;
 const live = new Set<object>(), calls: {name:string;args:any[]}[] = [], uniforms: Record<string,any>={};
 const state={lost:false,live,calls,uniforms,gl:null as any};
 const constants:Record<string,number>={NO_ERROR:0,MAX_TEXTURE_SIZE:0x0d33,TEXTURE0:0x84c0,ACTIVE_TEXTURE:0x84e0,UNPACK_ALIGNMENT:0x0cf5};
 const methods:Record<string,any>={
  isContextLost:()=>state.lost,
  getParameter:(name:number)=>name===constants.MAX_TEXTURE_SIZE?8192:name===constants.ACTIVE_TEXTURE?constants.TEXTURE0:name===constants.UNPACK_ALIGNMENT?4:0,
  getShaderParameter:()=>!failCompile,getProgramParameter:()=>true,getError:()=>0,
  getUniformLocation:(_p:any,name:string)=>name,
  getExtension:(name:string)=>name==='WEBGL_lose_context'?{loseContext(){state.lost=true;live.clear();calls.push({name:'loseContext',args:[]});}}:null,
 };
 state.gl=new Proxy({}, {get(_target,property){const name=String(property);
  if(/^[A-Z0-9_]+$/.test(name))return constants[name]??(constants[name]=++constant);
  if(methods[name])return methods[name];
  return (...args:any[])=>{
   calls.push({name,args});
   if(name.startsWith('create')){const value={type:name,serial:++serial};live.add(value);return value;}
   if(name.startsWith('delete'))live.delete(args[0]);
   if(name.startsWith('uniform'))uniforms[args[0]]=name==='uniformMatrix3fv'?Array.from(args[2]):args.slice(1);
  };
 }});
 return state;
}
async function setup({width=1440,height=900,unavailable=false,failCompile=false}={}) {
 const window=new Window({url:'http://localhost:3784/',width,height}), doc=window.document;
 doc.write((await readFile(root+'tests/fixtures/observer.html','utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
 Object.defineProperty(doc,'hidden',{value:false});
 const names=JSON.parse(await readFile(root+'public/data/named-stars.json','utf8'));
 const fetches:string[]=[];window.fetch=(async(url:any)=>{fetches.push(String(url));return {ok:true,json:async()=>names};}) as any;
 const images:ControlledImage[]=[];
 (window as any).Image=class extends ControlledImage {constructor(){super();images.push(this);}};
 const contexts:ReturnType<typeof fakeGL>[]=[];
 const sizes={width,height};
 Object.defineProperty(window.HTMLCanvasElement.prototype,'clientWidth',{get(){return sizes.width;},configurable:true});
 Object.defineProperty(window.HTMLCanvasElement.prototype,'clientHeight',{get(){return sizes.height;},configurable:true});
 window.HTMLCanvasElement.prototype.getContext=function(){if(unavailable)return null;const gl=fakeGL(failCompile);contexts.push(gl);return gl.gl; } as any;
 const captures=new Set<number>();
 window.HTMLCanvasElement.prototype.setPointerCapture=(id:number)=>{captures.add(id);};
 window.HTMLCanvasElement.prototype.hasPointerCapture=(id:number)=>captures.has(id);
 window.HTMLCanvasElement.prototype.releasePointerCapture=(id:number)=>{captures.delete(id);};
 let rafId=0;const rafs=new Map<number,FrameRequestCallback>();
 window.requestAnimationFrame=((fn:FrameRequestCallback)=>{const id=++rafId;rafs.set(id,fn);return id;}) as any;
 window.cancelAnimationFrame=(id:number)=>{rafs.delete(id);};
 window.eval(await bundle());
 for(let i=0;i<30&&!doc.body.dataset.ready;i++)await new Promise<void>(r=>setImmediate(r));
 assert.equal(doc.body.dataset.ready,'true');
 let now=window.performance.now();
 const tick=(ms=100)=>{now+=ms;const callbacks=[...rafs.values()];rafs.clear();for(const fn of callbacks)fn(now);};
 const el=(id:string)=>doc.getElementById(id) as any;
 const input=(value:string)=>{el('search').value=value;el('search').dispatchEvent(new window.Event('input'));};
 const key=(target:any,key:string,shiftKey=false)=>{const e=new window.KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true,shiftKey});target.dispatchEvent(e);return e;};
 const open=()=>{el('planets-open').click();el('planets-list').querySelector('[data-inspector="earth"]').click();};
 const pointer=(type:string,id:number,x:number,y=200)=>el('earth-canvas').dispatchEvent(new window.PointerEvent(type,{pointerId:id,button:0,clientX:x,clientY:y,bubbles:true}));
 const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
 const readyImage=async(image=images.at(-1)!)=>{image.load();image.resolve();await flush();tick();};
 return {window,doc,el,tick,key,input,open,pointer,images,contexts,fetches,rafs,captures,sizes,flush,readyImage,app:(window as any).__galaxy,
  close:async()=>{if(el('earth-dialog').open)el('earth-close').click();await window.happyDOM.abort();}};
}

test('Earth helpers are finite/bounded, default Asia/Pacific, orthonormal and round for portrait/landscape/DPR',()=>{
 const view=defaultEarthView();assert.equal(view.longitude,140);assert.equal(view.latitude,20);
 for(const [width,height] of [[1440,900],[390,844],[844,390],[2048,1024]])for(const scale of [.65,1,4]){
  const r=earthRadius(width,height,scale);assert.equal(r,Math.min(width,height)*.4*scale);
  // Independent orthographic pixel coordinates: same radius on both axes.
  const horizontal=Math.hypot((width/2+r)-width/2,0),vertical=Math.hypot(0,(height/2+r)-height/2);
  assert.ok(Math.abs(horizontal-vertical)<1e-10);
 }
 for(let i=0;i<50;i++)zoomEarth(view,2);assert.equal(view.zoom,EARTH_MAX_ZOOM);
 for(let i=0;i<50;i++)zoomEarth(view,.5);assert.equal(view.zoom,EARTH_MIN_ZOOM);
 for(const factor of [NaN,Infinity,0,-1])zoomEarth(view,factor);assert.equal(view.zoom,EARTH_MIN_ZOOM);
 rotateEarth(view,12345,100000,390);assert.equal(view.latitude,89.5);assert.ok(view.longitude>=-180&&view.longitude<180);
 for(const latitude of [-89.5,-30,20,89.5])for(const longitude of [-180,0,140,179]){
  const m=earthRotation({longitude,latitude,zoom:1});
  for(let a=0;a<3;a++)for(let b=0;b<3;b++)assert.ok(Math.abs(m[a*3]*m[b*3]+m[a*3+1]*m[b*3+1]+m[a*3+2]*m[b*3+2]-(a===b?1:0))<1e-6);
 }
});

test('startup creates no Earth context/canvas/image requests; nine scientific bodies and labels stay unchanged',async()=>{
 const f=await setup();try{
  f.tick();assert.equal(f.contexts.length,0);assert.equal(f.images.length,0);assert.equal(f.el('earth-canvas'),null);
  assert.deepEqual(Array.from(f.app.state.bodies,(b:any)=>b.id),skyIds);
  assert.equal(f.doc.querySelectorAll('.body-label').length,9);assert.ok(!f.doc.querySelector('#sky-labels')!.textContent!.includes('地球'));
  f.el('planets-open').click();const menu=f.el('planets-list');
  assert.equal(menu.children.length,10);assert.equal(menu.querySelectorAll('[data-body]').length,9);assert.equal(menu.querySelector('[data-body="earth"]'),null);
  assert.match(menu.querySelector('[data-inspector="earth"]').textContent,/地球.*球体预览/);
  assert.equal(f.contexts.length,0);assert.equal(f.images.length,0);
  assert.ok(f.fetches.every(url=>!url.includes('earth')));
 }finally{await f.close();}
});

for(const query of ['地球','Earth','earth','EARTH'])test(`dedicated ${query} search opens an inspector, never invents Earth sky data`,async()=>{
 const f=await setup();try{
  f.app.select('moon');f.tick();const selected=plain(f.app.selected),facts=f.el('object-facts').textContent;
  f.input(query);const result=f.el('search-results').querySelector('button');
  assert.equal(result.dataset.targetKind,'inspector');assert.match(result.textContent,/地球.*球体预览/);result.click();f.tick();
  assert.equal(f.el('earth-dialog').open,true);assert.equal(f.el('search-results').hidden,true);assert.equal(f.doc.activeElement,f.el('earth-canvas'));
  assert.deepEqual(plain(f.app.selected),selected);assert.equal(f.el('object-facts').textContent,facts);assert.equal(f.app.state.bodies.length,9);
  assert.equal(f.contexts.length,1);assert.equal(f.images.length,1);assert.match(f.images[0].requested,/\/textures\/2k_earth_daymap.jpg$/);
  assert.match(f.el('earth-description').textContent,/以地球为观测点.*非实时卫星影像\/天气/);
  assert.equal(f.el('earth-dialog').querySelector('a[href="./textures/detail/earth-credits.json"]').textContent,'地球素材与处理记录');
  f.key(f.el('earth-canvas'),'Escape');assert.equal(f.el('earth-dialog').open,false);assert.equal(f.doc.activeElement,f.el('search'));
 }finally{await f.close();}
});

for(const [width,height] of [[1440,900],[390,844],[844,390]])test(`Earth pointer/keyboard/resize/zoom and close controls at ${width}x${height}`,async()=>{
 const f=await setup({width,height});try{
  f.open();f.tick();const gl=f.contexts[0],c=f.el('earth-canvas'),initial=plain(gl.uniforms.uRotation),initialRadius=gl.uniforms.uRadius[0];
  assert.equal(f.el('planets-dialog').open,false);assert.equal(f.doc.activeElement,c);
  f.pointer('pointerdown',1,200);f.pointer('pointermove',1,250,250);f.pointer('pointerup',1,250,250);f.tick();
  assert.notDeepEqual(gl.uniforms.uRotation,initial);const stopped=plain(gl.uniforms.uRotation);f.tick(1000);assert.deepEqual(gl.uniforms.uRotation,stopped,'no auto spin or inertia');
  f.el('earth-reset').click();f.tick();assert.deepEqual(gl.uniforms.uRotation,initial);
  f.pointer('pointerdown',1,100);f.pointer('pointerdown',2,200);f.pointer('pointermove',2,300);f.tick();assert.equal(gl.uniforms.uRadius[0],initialRadius*2);
  f.pointer('pointerdown',3,350);f.pointer('pointermove',3,351);f.pointer('pointerup',2,300);f.pointer('pointermove',3,352);f.tick();assert.ok(Math.abs(gl.uniforms.uRadius[0]/(initialRadius*2)-252/251)<1e-10);
  f.pointer('pointercancel',1,100);f.pointer('lostpointercapture',3,352);assert.equal(f.captures.size,0);
  for(let i=0;i<30;i++)f.key(c,'+');f.tick();assert.equal(gl.uniforms.uRadius[0],initialRadius*4);
  for(let i=0;i<30;i++)f.el('earth-minus').click();f.tick();assert.equal(gl.uniforms.uRadius[0],initialRadius*.65);
  const wheel=new f.window.WheelEvent('wheel',{deltaY:-200,bubbles:true,cancelable:true});c.dispatchEvent(wheel);assert.equal(wheel.defaultPrevented,true);f.tick();assert.ok(gl.uniforms.uRadius[0]>initialRadius*.65);
  f.key(c,'r');f.key(c,'ArrowRight');f.key(c,'ArrowUp');f.tick();assert.notDeepEqual(gl.uniforms.uRotation,initial);
  f.key(c,'Home');f.tick();assert.deepEqual(gl.uniforms.uRotation,initial);assert.equal(gl.uniforms.uRadius[0],initialRadius);
  [f.sizes.width,f.sizes.height]=[height,width];f.window.dispatchEvent(new f.window.Event('resize'));f.tick();
  assert.deepEqual(gl.uniforms.uViewport,[height,width]);assert.equal(gl.uniforms.uRadius[0],initialRadius);
  const first=f.el('earth-close'),last=f.el('earth-dialog').querySelectorAll('a');first.focus();assert.equal(f.key(first,'Tab',true).defaultPrevented,true);assert.equal(f.doc.activeElement,last[last.length-1]);
  assert.equal(f.key(last[last.length-1],'Tab').defaultPrevented,true);assert.equal(f.doc.activeElement,first);
  f.el('earth-back').click();assert.equal(f.el('earth-dialog').open,false);assert.equal(f.el('earth-canvas'),null);assert.equal(f.doc.activeElement,f.el('planets-open'));assert.equal(gl.live.size,0);assert.equal(f.rafs.size,1);
 }finally{await f.close();}
});

for(const speed of [0,1,60,-60])test(`modal preserves sky camera/selection/follow/preferences and ${speed}x clock semantics`,async()=>{
 const f=await setup();try{
  f.app.setDate('2026-10-14T02:00:00Z');f.tick();f.app.select('neptune');for(let i=0;i<80;i++)f.tick();
  if(speed===1)f.el('forward').click();
  if(speed===60){f.el('forward').click();f.el('forward').click();}
  if(speed===-60){f.el('rewind').click();f.el('rewind').click();}
  assert.equal(f.app.speed,speed);f.tick(300);
  const timestamp=f.app.state.date.getTime(),camera=plain(f.app.camera),settings=plain(f.app.settings),selected=plain(f.app.selected),prefs=f.window.localStorage.getItem('galaxy-allsky-v2');
  const draws=(f.window as any).__skyRenders;
  f.open();for(let i=0;i<10;i++)f.tick(100);
  assert.equal((f.window as any).__skyRenders,draws,'no hidden sky GL work');assert.equal(f.app.state.date.getTime(),timestamp,'no hidden sky recompute');
  assert.deepEqual(plain(f.app.camera),camera);assert.deepEqual(plain(f.app.selected),selected);assert.equal(f.app.speed,speed);
  assert.equal(f.el('object-track').getAttribute('aria-pressed'),'true');assert.equal(f.window.localStorage.getItem('galaxy-allsky-v2'),prefs);assert.deepEqual(plain(f.app.settings),settings);
  f.key(f.el('earth-canvas'),'Escape');f.tick(100);
  assert.equal(f.app.state.date.getTime(),timestamp+1100*speed,'clock ticks once, no modal pause or double elapsed duration');
  assert.equal(f.app.speed,speed);assert.deepEqual(plain(f.app.selected),selected);assert.equal(f.app.camera.fovDeg,camera.fovDeg);
  const body=f.app.state.bodies.find((b:any)=>b.id==='neptune');assert.ok(Math.abs(f.app.camera.altitudeDeg-body.altitudeDeg)<1e-9);
  assert.equal(f.window.localStorage.getItem('galaxy-allsky-v2'),prefs);assert.ok((f.window as any).__skyRenders>draws);
 }finally{await f.close();}
});

test('live now-mode stays wall-clock based across inspector; debug Earth selection also uses inspector',async()=>{
 const f=await setup();try{
  let wall=Date.parse('2026-10-14T02:00:00Z');f.window.Date.now=()=>wall;
  f.el('now').click();f.tick();assert.equal(f.app.state.date.getTime(),wall);
  const camera=plain(f.app.camera);f.app.select('earth');assert.equal(f.el('earth-dialog').open,true);assert.equal(f.app.selected,null);
  wall+=5000;f.tick(5000);f.el('earth-close').click();f.tick();
  assert.equal(f.app.state.date.getTime(),wall);assert.equal(f.app.speed,1);assert.deepEqual(plain(f.app.camera),camera);
 }finally{await f.close();}
});

test('only lazy Earth 2K then stable 4K, conservative 64MiB cap, decoded uploads and all resources disposed',async()=>{
 const f=await setup();try{
  f.open();assert.equal(f.images.length,0,'open creates resources, first RAF starts images');f.tick();
  assert.equal(f.images.length,1);await f.readyImage(f.images[0]);
  assert.match(f.el('earth-status').textContent,/2K/);
  f.el('earth-plus').click();f.el('earth-plus').click();f.tick();const before=f.images.length;
  f.tick(100);assert.equal(f.images.length,before,'no HD in a moving/short stable interval');f.tick(400);
  assert.match(f.images.at(-1)!.requested,/detail\/4k_earth_daymap.jpg$/);await f.readyImage();assert.match(f.el('earth-status').textContent,/4K/);
  for(let i=0;i<20;i++)f.el('earth-plus').click();f.tick();f.tick(1000);
  assert.equal(f.images.some(image=>image.requested.includes('8k')),false);assert.equal(EARTH_TEXTURE_BUDGET,64*1024*1024);
  const gl=f.contexts[0];assert.ok(gl.calls.some(call=>call.name==='drawArrays'));assert.equal(gl.uniforms.uReady[0],1);
  const draws=gl.calls.filter(call=>call.name==='drawArrays').length;f.el('earth-close').click();f.tick();
  assert.equal(gl.live.size,0);assert.equal(gl.lost,true);assert.equal(gl.calls.filter(call=>call.name==='drawArrays').length,draws);
  assert.equal(f.rafs.size,1);assert.equal(f.images.every(image=>!image.onload&&!image.onerror),true);
 }finally{await f.close();}
});

test('bounded texture failure stays visible instead of blank, and failure to upgrade retains good base',async()=>{
 const f=await setup();try{
  f.open();f.tick();
  for(let attempt=0;attempt<3;attempt++){for(const image of f.images)image.onerror?.();f.tick(100);f.tick(5000);}
  assert.match(f.el('earth-status').textContent,/加载失败.*占位/);assert.equal(f.contexts[0].uniforms.uReady[0],0);
  f.el('earth-close').click();f.open();f.tick();await f.readyImage();
  for(let i=0;i<5;i++)f.el('earth-plus').click();f.tick();f.tick(400);
  const latest=f.images.at(-1)!;assert.match(latest.requested,/4k_/);latest.onerror?.();f.tick();
  assert.match(f.el('earth-status').textContent,/2K.*保留已载入贴图/);assert.equal(f.contexts[1].uniforms.uReady[0],1);
 }finally{await f.close();}
});

test('blur and close release pointer captures; stale RAF and detached controls cannot revive globe',async()=>{
 const f=await setup();try{
  f.open();f.tick();const c=f.el('earth-canvas'),gl=f.contexts[0];
  f.pointer('pointerdown',10,100);f.pointer('pointerdown',11,200);assert.equal(f.captures.size,2);
  f.window.dispatchEvent(new f.window.Event('blur'));assert.equal(f.captures.size,0);
  f.pointer('pointerdown',12,300);const callbacks=[...f.rafs.values()];
  const before=gl.calls.length;f.el('earth-close').click();assert.equal(f.captures.size,0);
  const after=gl.calls.length;for(const fn of callbacks)fn(f.window.performance.now()+1000);
  c.dispatchEvent(new f.window.WheelEvent('wheel',{deltaY:-200,bubbles:true}));
  assert.equal(gl.calls.length,after);assert.ok(after>before);assert.equal(gl.live.size,0);
 }finally{await f.close();}
});

test('late decode completion and old close event cannot revive/dispose a reopened inspector',async()=>{
 const f=await setup();try{
  f.open();f.tick();const image=f.images[0],oldCanvas=f.el('earth-canvas'),oldGL=f.contexts[0];image.load();
  f.el('earth-close').click();f.open();f.tick();const current=f.el('earth-canvas');assert.notEqual(current,oldCanvas);
  image.resolve();await f.flush();oldCanvas.dispatchEvent(new f.window.Event('webglcontextlost',{cancelable:true}));
  f.el('earth-dialog').dispatchEvent(new f.window.Event('close'));f.tick();
  assert.equal(f.el('earth-dialog').open,true);assert.equal(f.el('earth-canvas'),current);assert.equal(oldGL.live.size,0);
  assert.equal(oldGL.calls.filter(call=>call.name==='texImage2D').length,1,'only initial 1x1 placeholder, no late decode upload');
  assert.equal(f.rafs.size,2);f.el('earth-close').click();assert.equal(f.rafs.size,1);
 }finally{await f.close();}
});

test('context loss stops Earth RAF, prevents late revival, exposes error, and reopening has a fresh context',async()=>{
 const f=await setup();try{
  f.open();f.tick();const gl=f.contexts[0],image=f.images[0],canvas=f.el('earth-canvas');image.load();
  gl.lost=true;gl.live.clear();const event=new f.window.Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);assert.match(f.el('earth-status').textContent,/上下文已中断/);assert.equal(f.rafs.size,1);
  const draws=gl.calls.filter(call=>call.name==='drawArrays').length;image.resolve();await f.flush();canvas.dispatchEvent(new f.window.Event('webglcontextrestored'));f.tick();
  assert.equal(gl.calls.filter(call=>call.name==='drawArrays').length,draws);assert.match(f.el('earth-status').textContent,/上下文已中断/);
  f.key(canvas,'Escape');f.tick();assert.equal(f.doc.body.dataset.ready,'true');f.open();f.tick();assert.equal(f.contexts.length,2);assert.equal(f.contexts[1].lost,false);
 }finally{await f.close();}
});

for(const options of [{unavailable:true},{failCompile:true}])test(`GL startup error is visible and original sky still usable: ${JSON.stringify(options)}`,async()=>{
 const f=await setup(options);try{
  f.open();f.tick();assert.match(f.el('earth-status').textContent,/WebGL2|编译失败/);assert.equal(f.el('earth-status').dataset.error,'true');
  f.el('earth-back').click();f.tick();assert.equal(f.doc.body.dataset.ready,'true');assert.equal(f.contexts.every(gl=>gl.live.size===0),true);
 }finally{await f.close();}
});

test('backdrop, native cancel, direct dialog close and repeated openings release exactly once',async()=>{
 const f=await setup();try{
  for(const mode of ['backdrop','cancel','direct','button','escape']){
   f.open();f.tick();const dialog=f.el('earth-dialog');
   if(mode==='backdrop')dialog.dispatchEvent(new f.window.MouseEvent('click',{clientX:-50,clientY:-50,bubbles:true}));
   if(mode==='cancel')dialog.dispatchEvent(new f.window.Event('cancel',{cancelable:true}));
   if(mode==='direct')dialog.close();
   if(mode==='button')f.el('earth-close').click();
   if(mode==='escape')f.key(f.el('earth-canvas'),'Escape');
   await f.flush();f.tick();assert.equal(dialog.open,false);assert.equal(f.el('earth-canvas'),null);assert.equal(f.rafs.size,1);
   assert.equal(f.contexts.at(-1)!.live.size,0);assert.equal(f.doc.activeElement,f.el('planets-open'));
  }
  assert.equal(f.contexts.length,5);assert.equal(f.contexts.every(gl=>gl.calls.filter(call=>call.name==='loseContext').length===1),true);
 }finally{await f.close();}
});
