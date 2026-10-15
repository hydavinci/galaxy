import {fileURLToPath} from 'node:url';
// Actual coordinator, both application classes, astronomy/navigation and both
// renderers. Only browser/GL/network services are recorded; not pixel/browser QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
const root=fileURLToPath(new URL('../',import.meta.url));
let bundled:Promise<string>|undefined;
function bundle(){return bundled??=build({absWorkingDir:root,entryPoints:['src/app.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',plugins:[{name:'vite-text-imports',setup(b){
 b.onResolve({filter:/\?(inline|raw)$/},a=>({path:resolve(a.resolveDir,a.path.replace(/\?.*/,'')),namespace:'text'}));
 b.onLoad({filter:/.*/,namespace:'text'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));
}}]}).then(x=>x.outputFiles[0].text);}
const flush=async(n=12)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>setImmediate(r));};
function fakeGL(failCompile=false){
 let serial=0,constant=1000;
 const live=new Set<object>(),calls:Record<string,number>={};
 const state={lost:false,live,calls,gl:null as any};
 const constants:Record<string,number>={NO_ERROR:0,MAX_TEXTURE_SIZE:3379,ALIASED_POINT_SIZE_RANGE:33901,TEXTURE0:33984,ACTIVE_TEXTURE:34016,UNPACK_ALIGNMENT:3317};
 const methods:Record<string,any>={
  isContextLost:()=>state.lost,getError:()=>0,
  getParameter:(p:number)=>p===3379?8192:p===33901?new Float32Array([1,64]):p===34016?33984:p===3317?4:0,
  getShaderParameter:()=>!failCompile,getProgramParameter:()=>true,getShaderInfoLog:()=>failCompile?'fixture shader failure':'',getProgramInfoLog:()=>'',
  getUniformLocation:(_p:any,name:string)=>name,getAttribLocation:()=>0,
  getExtension:(name:string)=>name==='WEBGL_lose_context'?{loseContext(){state.lost=true;live.clear();calls.loseContext=(calls.loseContext||0)+1;}}:null,
 };
 state.gl=new Proxy({}, {get(_target,key){const name=String(key);
  if(/^[A-Z0-9_]+$/.test(name))return constants[name]??(constants[name]=++constant);
  if(methods[name])return methods[name];
  return(...args:any[])=>{calls[name]=(calls[name]||0)+1;if(name.startsWith('create')){const value={name,serial:++serial};live.add(value);return value;}if(name.startsWith('delete'))live.delete(args[0]);};
 }});return state;
}
class PendingImage {
 onload:Function|null=null;onerror:Function|null=null;naturalWidth=2048;naturalHeight=1024;crossOrigin='';decoding='';src='';
 decode(){return Promise.resolve();}
}
async function fixture(options:{unavailable?:boolean;failCompile?:boolean;failNames?:boolean;hold?:string;ignoreAbort?:boolean;holdBody?:boolean}={}){
 const w=new Window({url:'https://galaxy.example/',width:1200,height:800}),d=w.document;
 d.write((await readFile(root+'src/index.html','utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
 Object.defineProperty(d,'hidden',{value:false});(w as any).Image=PendingImage;
 const policy={...options};const contexts:Array<ReturnType<typeof fakeGL>&{canvas:HTMLCanvasElement}>=[],contextByCanvas=new WeakMap<object,any>();
 let getContextCalls=0;
 Object.defineProperties(w.HTMLCanvasElement.prototype,{clientWidth:{get(){return 1200},configurable:true},clientHeight:{get(){return 800},configurable:true}});
 w.HTMLCanvasElement.prototype.getContext=function(){getContextCalls++;if(policy.unavailable)return null;const existing=contextByCanvas.get(this);if(existing)return existing.gl;const gl=Object.assign(fakeGL(policy.failCompile),{canvas:this as any});contexts.push(gl);contextByCanvas.set(this,gl);return gl.gl;} as any;
 w.HTMLCanvasElement.prototype.setPointerCapture=()=>{};w.HTMLCanvasElement.prototype.hasPointerCapture=()=>false;w.HTMLCanvasElement.prototype.releasePointerCapture=()=>{};
 // Count exactly the globals owned by applications, not detached DOM handlers.
 const listeners=new Map<EventTarget,Map<string,Set<any>>>();
 for(const target of [w,d]){
  const map=new Map<string,Set<any>>();listeners.set(target as any,map);
  const add=target.addEventListener.bind(target) as any,remove=target.removeEventListener.bind(target) as any;
  target.addEventListener=((type:string,fn:any,opts:any)=>{if(!map.has(type))map.set(type,new Set());map.get(type)!.add(fn);add(type,fn,opts);}) as any;
  target.removeEventListener=((type:string,fn:any,opts:any)=>{map.get(type)?.delete(fn);remove(type,fn,opts);}) as any;
 }
 const listenerCount=()=>[...listeners.values()].reduce((sum,m)=>sum+[...m.values()].reduce((n,s)=>n+s.size,0),0);
 const observers:Array<{nodes:Set<any>;disconnected:boolean}>=[];
 w.ResizeObserver=class {record={nodes:new Set<any>(),disconnected:false};constructor(){observers.push(this.record);}observe(n:any){this.record.nodes.add(n);}unobserve(n:any){this.record.nodes.delete(n);}disconnect(){this.record.nodes.clear();this.record.disconnected=true;}} as any;
 let rafId=0,now=w.performance.now();const rafs=new Map<number,FrameRequestCallback>();
 w.requestAnimationFrame=(fn:FrameRequestCallback)=>{const id=++rafId;rafs.set(id,fn);return id;};w.cancelAnimationFrame=(id:number)=>{rafs.delete(id);};
 const timers=new Set<any>(),setTimer=w.setTimeout.bind(w),clearTimer=w.clearTimeout.bind(w);
 w.setTimeout=((fn:any,ms?:number,...args:any[])=>{let id:any;id=setTimer(()=>{timers.delete(id);fn(...args);},ms);timers.add(id);return id;}) as any;
 w.clearTimeout=((id:any)=>{timers.delete(id);clearTimer(id);}) as any;
 const files=new Map<string,Buffer>();
 for(const path of ['space-stars.json','named-stars.json','stars-lod0.bin','stars-lod1.bin','stars-lod2.bin','stars-lod3.bin','stars-lod4.bin'])files.set('/data/'+path,await readFile(root+'public/data/'+path));
 const requests:Array<{path:string;signal?:AbortSignal;pending:boolean;resolve?:()=>void;aborted:boolean}>=[];
 w.fetch=((url:any,init:any={})=>{
  const path=new URL(String(url),w.document.baseURI).pathname,data=files.get(path);if(!data)return Promise.reject(new Error('unexpected fetch '+path));
  const req={path,signal:init.signal,pending:false,aborted:false,resolve:undefined as undefined|(()=>void)};requests.push(req);
  if(policy.failNames&&path.endsWith('/named-stars.json'))return Promise.reject(new Error('names offline'));
  const payload=()=>({ok:true,json:async()=>JSON.parse(data.toString()),arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)});
  if(!policy.hold||!path.includes(policy.hold))return Promise.resolve(payload());
  req.pending=true;
  const hold=new Promise<any>((resolve,reject)=>{
   req.resolve=()=>{req.pending=false;resolve(policy.holdBody?JSON.parse(data.toString()):payload());};
   init.signal?.addEventListener('abort',()=>{req.aborted=true;if(!policy.ignoreAbort){req.pending=false;reject(new w.DOMException('cancelled','AbortError'));}},{once:true});
  });
  return policy.holdBody?Promise.resolve({...payload(),json:()=>hold}):hold;
 }) as any;
 const spacePrefs={labels:false,cinematic:false,photographicBackground:false};
 const skyPrefs={location:{name:'悉尼',latitude:-33.86,longitude:151.2,elevation:10,timezone:'Australia/Sydney'},settings:{ground:false,atmosphere:false,refraction:false,constellations:true,grid:true,labels:false,milkyWay:false,mode:'enhanced',lightPollution:7}};
 w.localStorage.setItem('galaxy-space-v1',JSON.stringify(spacePrefs));w.localStorage.setItem('galaxy-allsky-v2',JSON.stringify(skyPrefs));w.localStorage.setItem('unrelated-preference','untouched');
 w.eval(await bundle());
 const el=(id:string)=>d.getElementById(id) as any;
 const main=()=>(w as any).__main;
 const ready=async()=>{for(let i=0;i<80&&main()?.status==='loading';i++)await flush(1);assert.equal(main()?.status,'ready',el('main-status').textContent);};
 const tick=()=>{now+=16.667;const queue=[...rafs.values()];rafs.clear();for(const fn of queue)fn(now);};
 const active=()=>contexts.filter(c=>!c.lost);
 const retry=async()=>{await main().retry();await ready();};
 const close=async()=>{main()?.dispose();await flush(2);await w.happyDOM.abort();};
 return {w,d,el,main,ready,tick,retry,close,policy,contexts,active,rafs,timers,listeners,listenerCount,observers,requests,spacePrefs,skyPrefs,getContextCalls:()=>getContextCalls};
}

test('sole main app boots spatial world with no observer, mode selector or effect button',async()=>{
 const f=await fixture();try{
  await f.ready();f.tick();const app=(f.w as any).__space;
  assert.equal(app.snapshot.bodies.length,10);assert.equal(f.el('space-body-list').children.length,10);
  assert.equal(f.active().length,1);assert.equal(f.d.querySelectorAll('canvas').length,1);assert.equal(f.rafs.size,1);
  assert.equal((f.w as any).__galaxy,undefined);assert.equal(f.main().switchMode,undefined);
  for(const selector of ['#observer-mode-link','#main-mode-nav','[data-switch-mode]','#sky','#earth-dialog','#space-cinematic'])assert.equal(f.d.querySelector(selector),null,selector);
  assert.ok(f.requests.every(r=>r.path==='/data/space-stars.json'));
  assert.equal(f.el('main-recovery').hidden,true);assert.equal(f.el('galaxy-mode-style').dataset.mode,'space');
  assert.match(f.el('galaxy-mode-style').textContent,/#space-canvas/);assert.doesNotMatch(f.el('galaxy-mode-style').textContent,/#sky\{/);
  assert.equal(f.w.location.href,'https://galaxy.example/');
 }finally{await f.close();}
});
test('deep-space is always on; legacy labels and unrelated observer stored preferences survive',async()=>{
 const f=await fixture();try{
  const sky=f.w.localStorage.getItem('galaxy-allsky-v2');await f.ready();f.tick();const app=(f.w as any).__space;
  assert.equal(app.options.cinematic,true);assert.equal(app.options.photographicBackground,true);assert.equal(app.options.labels,false);
  const saved=JSON.parse(f.w.localStorage.getItem('galaxy-space-v1')!);assert.equal(saved.cinematic,true);assert.equal(saved.photographicBackground,true);assert.equal(saved.labels,false);
  for(const id of ['space-objects','space-mode','space-label-toggle','space-rewind','space-pause','space-forward','space-now','space-nearer','space-farther','space-earth','space-system'])assert.ok(f.el(id),id);
  f.el('space-label-toggle').click();f.tick();assert.equal(app.options.labels,true);f.el('space-pause').click();f.tick();assert.equal(app.speed,0);f.el('space-mode').click();f.tick();assert.equal(app.view.mode,'free');
  f.el('space-objects').click();assert.ok(f.el('space-objects-dialog').open);f.el('space-objects-dialog').querySelector('[data-space-close]').click();
  await f.retry();assert.equal((f.w as any).__space.options.labels,true);assert.equal((f.w as any).__space.options.cinematic,true);
  assert.equal(f.w.localStorage.getItem('galaxy-allsky-v2'),sky);assert.equal(f.w.localStorage.getItem('unrelated-preference'),'untouched');
 }finally{await f.close();}
});
for(const holdBody of [false,true])test(`retry during held spatial ${holdBody?'response body':'fetch'} ignores late old initialization`,async()=>{
 const f=await fixture({hold:'space-stars.json',ignoreAbort:true,holdBody});try{
  await flush();assert.equal(f.main().status,'loading');const pending=f.requests.find(r=>r.pending)!;assert.ok(pending);const old=f.contexts[0];
  f.policy.hold=undefined;await f.retry();assert.ok(pending.aborted);assert.ok(old.lost);const app=(f.w as any).__space;
  pending.resolve!();await flush();f.tick();assert.equal((f.w as any).__space,app);assert.equal(f.main().status,'ready');assert.equal(f.active().length,1);assert.equal(f.rafs.size,1);assert.equal((f.w as any).__galaxy,undefined);
 }finally{await f.close();}
});
test('20 rapid retries mount only the final spatial request',async()=>{
 const f=await fixture({hold:'space-stars.json',ignoreAbort:true});try{
  await flush();const pending=f.requests.find(r=>r.pending)!;assert.ok(pending);f.policy.hold=undefined;
  await Promise.all(Array.from({length:20},()=>f.main().retry()));await f.ready();pending.resolve!();await flush();f.tick();
  assert.equal(f.active().length,1);assert.equal(f.rafs.size,1);assert.equal(f.d.querySelectorAll('canvas').length,1);assert.ok(f.contexts.length<=2);
 }finally{await f.close();}
});
test('20 completed retries keep globals/RAF/context bounded; final disposal clears all',async()=>{
 const f=await fixture();try{
  await f.ready();f.tick();const baseline={listeners:f.listenerCount(),timers:f.timers.size};
  for(let i=0;i<20;i++){await f.retry();f.tick();assert.deepEqual({listeners:f.listenerCount(),timers:f.timers.size},baseline);assert.equal(f.active().length,1);assert.equal(f.rafs.size,1);assert.equal(f.d.querySelectorAll('canvas').length,1);}
  const contexts=f.contexts.length;f.main().dispose();await flush();assert.equal(f.active().length,0);assert.equal(f.rafs.size,0);assert.equal(f.listenerCount(),0);assert.equal(f.timers.size,0);assert.equal(f.getContextCalls(),contexts);
  assert.equal(f.el('mode-root').childElementCount,0);assert.equal(f.el('galaxy-mode-style').textContent,'');assert.equal((f.w as any).__space,undefined);assert.equal((f.w as any).__main,undefined);
 }finally{await f.close();}
});
for(const fault of ['unavailable','failCompile'] as const)test(`3D ${fault} error has retry without observer fallback`,async()=>{
 const f=await fixture({[fault]:true});try{
  await flush();assert.equal(f.main().status,'error');assert.equal(f.el('main-recovery').hidden,false);assert.equal(f.el('main-mode-nav'),null);assert.equal(f.active().length,0);assert.equal(f.rafs.size,0);
  f.policy[fault]=false;f.el('main-retry').click();await f.ready();f.tick();assert.equal(f.active().length,1);assert.equal(f.rafs.size,1);assert.equal(f.el('main-recovery').hidden,true);assert.equal(f.w.location.href,'https://galaxy.example/');
 }finally{await f.close();}
});
test('runtime context loss retry restores only 3D, and stale disposal cannot touch the new context',async()=>{
 const f=await fixture();try{
  await f.ready();f.tick();const oldDebug=(f.w as any).__space,old=f.active()[0];f.el('space-canvas').dispatchEvent(new f.w.Event('webglcontextlost',{cancelable:true}));
  assert.equal(f.main().status,'error');assert.equal(f.el('main-recovery').hidden,false);assert.equal(f.active().length,0);assert.equal(f.rafs.size,0);
  await f.retry();f.tick();assert.notEqual((f.w as any).__space,oldDebug);oldDebug.dispose();assert.equal(f.active().length,1);assert.ok(old.lost);assert.equal((f.w as any).__galaxy,undefined);
 }finally{await f.close();}
});
test('dispose during pending startup cannot revive DOM or renderer on late response',async()=>{
 const f=await fixture({hold:'space-stars.json',ignoreAbort:true});try{
  await flush();const pending=f.requests.find(r=>r.pending)!;assert.ok(pending);f.main().dispose();pending.resolve!();await flush();
  assert.equal(f.active().length,0);assert.equal(f.rafs.size,0);assert.equal(f.el('mode-root').childElementCount,0);assert.equal((f.w as any).__space,undefined);assert.equal((f.w as any).__galaxy,undefined);
 }finally{await f.close();}
});
