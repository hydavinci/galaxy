import {fileURLToPath} from 'node:url';
// Real world/navigation/catalog with simulated DOM and a recording renderer.
// This proves event/coordinate wiring, not GPU appearance or browser ergonomics.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {build} from 'esbuild';import {Window} from 'happy-dom';
import {AU_KM} from '../src/space/types';
import {cameraBasis,add,scale} from '../src/space/math';import {projectSpace} from '../src/space/render-math';
const root=(process.env.MOUSE_TEST_ENGINE??fileURLToPath(new URL('../',import.meta.url))).replace(/\/?$/,'/');
let bundled:Promise<string>|undefined;
function bundle(){return bundled??=build({absWorkingDir:root,entryPoints:['tests/fixtures/space-entry.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',loader:{'.css':'empty'},plugins:[{name:'mock-space-renderer-only',setup(b){b.onResolve({filter:/^\.\/renderer$/},args=>args.importer.endsWith('/space/app.ts')?{path:'renderer',namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import {projectSpace} from '${root}src/space/render-math.ts'; export class SpaceRenderer {constructor(c){this.c=c;window.__spaceFrames=[];}async init(stars){this.stars=stars;}render(snapshot,view){window.__spaceFrames.push({date:snapshot.date.toISOString(),ids:snapshot.bodies.map(b=>b.id),camera:JSON.parse(JSON.stringify(view.camera))});}project(p,c){return projectSpace(p,c,this.c.clientWidth,this.c.clientHeight);}pick(){return 'earth';}getStats(){return {status:'Mock protocol only'};}dispose(){window.__spaceDisposed=true;}}`,loader:'ts',resolveDir:root}));}}]}).then(x=>x.outputFiles[0].text);}
const plain=(v:any)=>JSON.parse(JSON.stringify(v));
async function setup(width=1200,height=800){
 const w=new Window({url:'https://example.test/space/',width,height}),d=w.document;d.write((await readFile(root+'src/modes/space.html','utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
 const stars=JSON.parse(await readFile(root+'public/data/space-stars.json','utf8'));w.fetch=(async()=>({ok:true,json:async()=>stars})) as any;
 Object.defineProperty(d,'hidden',{value:false});const c=d.getElementById('space-canvas') as any;Object.defineProperties(c,{clientWidth:{value:width},clientHeight:{value:height}});
 const captures=new Set<number>();c.setPointerCapture=(id:number)=>captures.add(id);c.hasPointerCapture=(id:number)=>captures.has(id);c.releasePointerCapture=(id:number)=>captures.delete(id);
 let raf:FrameRequestCallback|undefined,now=w.performance.now();w.requestAnimationFrame=(fn:FrameRequestCallback)=>{raf=fn;return 1;};w.cancelAnimationFrame=()=>{raf=undefined;};w.eval(await bundle());
 for(let i=0;i<60&&d.body.dataset.spaceReady!=='true';i++)await new Promise<void>(r=>setImmediate(r));assert.equal(d.body.dataset.spaceReady,'true',d.getElementById('space-loading-text')?.textContent);
 const app=(w as any).__space,el=(id:string)=>d.getElementById(id) as any;
 const tick=(ms=16.667)=>{now+=ms;const fn=raf;raf=undefined;assert.ok(fn);fn(now);assert.equal(d.body.dataset.spaceReady,'true',el('space-loading-text').textContent);};
 const settle=()=>{for(let i=0;i<250;i++)tick();};
 const pointer=(type:string,id:number,x:number,y:number)=>c.dispatchEvent(new w.PointerEvent(type,{pointerType:'touch',pointerId:id,button:0,clientX:x,clientY:y,bubbles:true}));
 const key=(type:string,code:string,key=code)=>c.dispatchEvent(new w.KeyboardEvent(type,{code,key,bubbles:true,cancelable:true}));
 const search=(value:string)=>{el('space-search').value=value;el('space-search').dispatchEvent(new w.Event('input',{bubbles:true}));};
 return {w,d,c,app,el,tick,settle,pointer,key,search,width,height,captures,close:async()=>{app.dispose();await w.happyDOM.abort();}};
}
const positionDistance=(a:number[],b:number[])=>Math.hypot(...a.map((x,i)=>x-b[i]));
function raw(f:Awaited<ReturnType<typeof setup>>,type:string,button:number,buttons:number,x:number,y:number,id=1,pointerType='mouse'){
 const e=new f.w.PointerEvent(type,{pointerId:id,pointerType,button,buttons,clientX:x,clientY:y,bubbles:true,cancelable:true});f.c.dispatchEvent(e);return e;
}
function pause(f:Awaited<ReturnType<typeof setup>>){f.app.setDate('2026-10-15T00:00:00Z');if(f.app.speed!==0)f.el('space-pause').click();f.tick();}
for(const [width,height]of [[1000,700],[390,844]])test(`desktop left drag moves the whole angular view and middle drag orbits at ${width}x${height}`,async()=>{
 const f=await setup(width,height);try{pause(f);const before=plain(f.app.camera),id=f.app.selected,earth=f.app.snapshot.bodies.find((b:any)=>b.id==='earth'),start=projectSpace(earth.positionAU,before,width,height);
 raw(f,'pointerdown',0,1,width/2,height/2);raw(f,'pointermove',-1,1,width/2+50,height/2+25);raw(f,'pointerup',0,0,width/2+50,height/2+25);f.tick();const pan=plain(f.app.camera);assert.deepEqual(pan.positionAU,before.positionAU,'whole-view drag must not translate the camera');assert.equal(pan.fovDeg,before.fovDeg);assert.notEqual(pan.azimuthDeg,before.azimuthDeg);const moved=projectSpace(earth.positionAU,pan,width,height);assert.ok(moved.x>start.x&&moved.y>start.y,'foreground follows drag');const far=add(before.positionAU,scale(cameraBasis(before).forward,1e8));const star=projectSpace(far,pan,width,height);assert.ok(Math.abs(star.x-moved.x)<1e-4&&Math.abs(star.y-moved.y)<1e-4,'far background uses the same angular movement');assert.equal(f.app.view.mode,'free');assert.equal(f.app.selected,id);assert.equal(f.captures.size,0);
 const previous=plain(f.app.camera),selected=f.app.selected;const down=raw(f,'pointerdown',1,4,width/2,height/2);assert.equal(down.defaultPrevented,true);raw(f,'pointermove',-1,4,width/2+65,height/2-35);raw(f,'pointerup',1,0,width/2+65,height/2-35);f.tick();assert.equal(f.app.view.mode,'orbit');assert.equal(f.app.selected,selected);assert.ok(positionDistance(previous.positionAU,f.app.camera.positionAU)>1e-10);assert.equal(f.app.camera.fovDeg,previous.fovDeg);assert.equal(f.captures.size,0);const center=projectSpace(earth.positionAU,f.app.camera,width,height);assert.ok(Math.hypot(center.x-width/2,center.y-height/2)<1e-4);
 }finally{await f.close();}
});
test('only left click picks; middle click, right drag and left drag never pick on release',async()=>{
 const f=await setup();try{pause(f);f.app.select('mars');f.settle();const old=plain(f.app.camera);raw(f,'pointerdown',1,4,600,400);raw(f,'pointerup',1,0,600,400);assert.equal(f.app.selected,'mars');assert.deepEqual(plain(f.app.camera),old);raw(f,'pointerdown',2,2,600,400);raw(f,'pointermove',-1,2,640,420);raw(f,'pointerup',2,0,640,420);assert.equal(f.app.selected,'mars');assert.deepEqual(plain(f.app.camera),old);raw(f,'pointerdown',0,1,600,400);raw(f,'pointermove',-1,1,640,420);raw(f,'pointerup',0,0,640,420);assert.equal(f.app.selected,'mars');raw(f,'pointerdown',0,1,600,400);raw(f,'pointerup',0,0,600,400);assert.equal(f.app.selected,'earth','recording fixture picks Earth only on click');}finally{await f.close();}
});
test('button masks lock mouse chords to their original owner and stop on lost release',async()=>{
 const f=await setup();try{pause(f);raw(f,'pointerdown',0,1,600,400);raw(f,'pointermove',1,5,625,410);assert.equal(f.app.view.mode,'free');const p=plain(f.app.camera);raw(f,'pointermove',0,4,650,420);assert.deepEqual(plain(f.app.camera),p);assert.equal(f.captures.size,0);raw(f,'pointermove',-1,4,680,440);assert.deepEqual(plain(f.app.camera),p);raw(f,'pointerup',1,0,680,440);
 raw(f,'pointerdown',1,4,600,400);raw(f,'pointermove',0,5,625,410);assert.equal(f.app.view.mode,'orbit');const q=plain(f.app.camera);raw(f,'pointermove',1,1,650,420);assert.deepEqual(plain(f.app.camera),q);assert.equal(f.captures.size,0);raw(f,'pointermove',-1,0,700,440);raw(f,'pointerup',0,0,700,440);assert.deepEqual(plain(f.app.camera),q);
 }finally{await f.close();}
});
test('cancel, lost capture, blur, modal and disposal release mouse ownership and preserve standard wheel zoom',async()=>{
 const f=await setup();try{pause(f);for(const kind of ['pointercancel','lostpointercapture','blur','modal']){raw(f,'pointerdown',1,4,600,400);raw(f,'pointermove',-1,4,620,410);if(kind==='blur')f.w.dispatchEvent(new f.w.Event('blur'));else if(kind==='modal'){f.el('space-help').click();f.el('space-help-dialog').querySelector('[data-space-close]').click();}else raw(f,kind,1,0,620,410);const p=plain(f.app.camera);raw(f,'pointermove',-1,4,670,430);assert.deepEqual(plain(f.app.camera),p);assert.equal(f.captures.size,0);}
 const before=plain(f.app.camera);f.c.dispatchEvent(new f.w.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));assert.ok(positionDistance(before.positionAU,f.app.camera.positionAU)>0);assert.equal(f.app.camera.fovDeg,before.fovDeg);raw(f,'pointerdown',1,4,600,400);f.app.dispose();assert.equal(f.captures.size,0);const last=plain(f.app.camera);raw(f,'pointermove',-1,4,680,430);assert.deepEqual(plain(f.app.camera),last);
 }finally{await f.close();}
});
test('middle browser defaults are suppressed only on canvas; touch/pen keep their previous orbit and free-look gestures',async()=>{
 const f=await setup();try{pause(f);for(const type of ['mousedown','auxclick']){const e=new f.w.MouseEvent(type,{button:1,buttons:type==='mousedown'?4:0,bubbles:true,cancelable:true});f.c.dispatchEvent(e);assert.equal(e.defaultPrevented,true);const link=new f.w.MouseEvent(type,{button:1,bubbles:true,cancelable:true});f.el('space-help').dispatchEvent(link);assert.equal(link.defaultPrevented,false);}
 for(const pointerType of ['touch','pen']){f.el('space-earth').click();const start=plain(f.app.camera);raw(f,'pointerdown',0,1,500,350,11,pointerType);raw(f,'pointermove',-1,1,540,370,11,pointerType);raw(f,'pointerup',0,0,540,370,11,pointerType);assert.ok(positionDistance(start.positionAU,f.app.camera.positionAU)>0);f.el('space-mode').click();const free=plain(f.app.camera);raw(f,'pointerdown',0,1,500,350,11,pointerType);raw(f,'pointermove',-1,1,540,370,11,pointerType);raw(f,'pointerup',0,0,540,370,11,pointerType);assert.deepEqual(plain(f.app.camera.positionAU),free.positionAU);assert.notEqual(f.app.camera.azimuthDeg,free.azimuthDeg);}
 }finally{await f.close();}
});
test('touch pinch continues after two-to-one transition and mouse/touch mixing does not become pinch',async()=>{
 const f=await setup();try{pause(f);const t='touch';raw(f,'pointerdown',0,1,400,350,11,t);raw(f,'pointerdown',0,1,600,350,12,t);const start=plain(f.app.camera);raw(f,'pointermove',-1,1,650,350,12,t);assert.ok(positionDistance(start.positionAU,f.app.camera.positionAU)>0);raw(f,'pointerup',0,0,650,350,12,t);const one=plain(f.app.camera);raw(f,'pointermove',-1,1,440,370,11,t);assert.ok(positionDistance(one.positionAU,f.app.camera.positionAU)>0);raw(f,'pointerup',0,0,440,370,11,t);assert.equal(f.captures.size,0);
 raw(f,'pointerdown',1,4,500,350,1);raw(f,'pointerdown',0,1,700,350,11,t);assert.equal(f.captures.size,1);const mouse=plain(f.app.camera);raw(f,'pointermove',-1,1,780,350,11,t);assert.deepEqual(plain(f.app.camera),mouse);raw(f,'pointerup',1,0,500,350,1);
 }finally{await f.close();}
});

for(const [width,height]of [[1000,700],[390,844]])for(const mode of ['orbit','free'])test(`whole-view left drag moves near and far sightlines together ${mode} ${width}x${height}`,async()=>{
 const f=await setup(width,height);try{pause(f);
  for(const [dx,dy]of [[45,0],[-45,0],[0,35],[0,-35],[35,25],[-35,25],[35,-25],[-35,-25]]){
   f.el('space-earth').click();if(f.app.view.mode!=='free')f.el('space-mode').click();
   // Noncommuting touch turns create a rolled view without changing the desktop binding.
   raw(f,'pointerdown',0,1,400,300,11,'touch');raw(f,'pointermove',-1,1,455,370,11,'touch');raw(f,'pointerup',0,0,455,370,11,'touch');
   raw(f,'pointerdown',0,1,400,300,12,'touch');raw(f,'pointermove',-1,1,445,285,12,'touch');raw(f,'pointerup',0,0,445,285,12,'touch');
   if(f.app.view.mode!==mode)f.el('space-mode').click();const before=plain(f.app.camera),basis=cameraBasis(before),selected=f.app.selected,time=f.app.snapshot.date.getTime();
   const nearPoint=add(before.positionAU,scale(basis.forward,.001)),farPoint=add(before.positionAU,scale(basis.forward,1e7));
   raw(f,'pointerdown',0,1,width/2,height/2);raw(f,'pointermove',-1,1,width/2+dx,height/2+dy);raw(f,'pointerup',0,0,width/2+dx,height/2+dy);f.tick();
   const after=plain(f.app.camera),p=projectSpace(nearPoint,after,width,height),far=projectSpace(farPoint,after,width,height);
   assert.deepEqual(after.positionAU,before.positionAU);assert.equal(after.fovDeg,before.fovDeg);assert.equal(f.app.selected,selected);assert.equal(f.app.snapshot.date.getTime(),time);assert.equal(f.app.view.mode,'free');
   const angle=Math.hypot(dx,dy)/height*before.fovDeg*Math.PI/180,gain=height*Math.tan(angle)/(2*Math.tan(before.fovDeg*Math.PI/360)*Math.hypot(dx,dy));
   assert.ok(Math.abs(p.x-width/2-dx*gain)<1e-5);assert.ok(Math.abs(p.y-height/2-dy*gain)<1e-5);assert.ok(Math.hypot(far.x-p.x,far.y-p.y)<1e-5);assert.ok(Math.hypot(far.x-width/2,far.y-height/2)>20);
  }
 }finally{await f.close();}
});
test('left view dragging is independent of selected target distance and returns to the same orientation on inverse input',async()=>{
 const f=await setup();try{pause(f);const original=plain(f.app.camera);raw(f,'pointerdown',0,1,600,400);raw(f,'pointermove',-1,1,690,355);raw(f,'pointermove',-1,1,600,400);raw(f,'pointerup',0,0,600,400);const after=plain(f.app.camera);assert.deepEqual(after.positionAU,original.positionAU);const a=cameraBasis(after),b=cameraBasis(original);for(const k of ['forward','right','up'] as const)assert.ok(positionDistance(a[k],b[k])<1e-9);assert.equal(after.fovDeg,original.fovDeg);assert.equal(f.captures.size,0);const source=await readFile(root+'src/space/app.ts','utf8');assert.doesNotMatch(source,/panDistanceAU/);assert.match(source,/old\.button===0\)this\.navigation\.look/);assert.match(f.el('space-help-dialog').textContent,/背景星空、名称和目标一起转动/);}finally{await f.close();}
});
