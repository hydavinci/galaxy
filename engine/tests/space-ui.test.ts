import {fileURLToPath} from 'node:url';
// Real world/navigation/catalog with simulated DOM and a recording renderer.
// This proves event/coordinate wiring, not GPU appearance or browser ergonomics.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {build} from 'esbuild';import {Window} from 'happy-dom';
import {AU_KM} from '../src/space/types';import {projectSpace} from '../src/space/render-math';
const root=fileURLToPath(new URL('../',import.meta.url));
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
 return {w,d,c,app,el,tick,settle,pointer,key,search,width,height,close:async()=>{app.dispose();await w.happyDOM.abort();}};
}
const positionDistance=(a:number[],b:number[])=>Math.hypot(...a.map((x,i)=>x-b[i]));
for(const [width,height]of[[1200,800],[390,844],[844,390]])test(`space entry contains Earth and Moon in same world/canvas; real dolly/orbit/free motion ${width}x${height}`,async()=>{
 const f=await setup(width,height);try{
  f.app.setDate('2026-10-14T03:37:00Z');f.tick();assert.equal(f.app.snapshot.bodies.length,10);assert.equal(f.el('space-body-list').children.length,10);assert.ok(f.el('space-body-list').querySelector('[data-space-body=earth]'));assert.equal(f.d.querySelector('#earth-dialog,#earth-canvas,#location-open'),null);
  assert.equal(f.d.querySelectorAll('canvas').length,1);assert.ok(f.app.catalogCount>9000);
  const earth=f.app.snapshot.bodies.find((b:any)=>b.id==='earth'),moon=f.app.snapshot.bodies.find((b:any)=>b.id==='moon');const lunarKm=positionDistance(earth.positionAU,moon.positionAU)*AU_KM;assert.ok(lunarKm>340000&&lunarKm<420000);
  const before=f.app.camera,range=positionDistance(before.positionAU,earth.positionAU);f.el('space-nearer').click();f.tick();const after=f.app.camera;assert.equal(after.fovDeg,before.fovDeg);assert.ok(positionDistance(after.positionAU,earth.positionAU)<range);assert.ok(positionDistance(before.positionAU,after.positionAU)>1e-8);
  const radius=positionDistance(after.positionAU,earth.positionAU);f.pointer('pointerdown',1,width/2,height/2);f.pointer('pointermove',1,width/2+70,height/2+40);f.pointer('pointerup',1,width/2+70,height/2+40);f.tick();assert.ok(positionDistance(f.app.camera.positionAU,after.positionAU)>1e-8);assert.ok(Math.abs(positionDistance(f.app.camera.positionAU,earth.positionAU)/radius-1)<1e-7);assert.equal(f.app.camera.fovDeg,60);
  f.el('space-mode').click();assert.equal(f.app.view.mode,'free');const free=f.app.camera;f.key('keydown','KeyD','d');for(let i=0;i<30;i++)f.tick();f.key('keyup','KeyD','d');assert.ok(positionDistance(f.app.camera.positionAU,free.positionAU)>1e-8);assert.equal(f.app.camera.fovDeg,free.fovDeg);
  f.el('space-earth').click();f.tick();assert.equal(f.app.selected,'earth');assert.equal(f.app.view.mode,'orbit');assert.equal(f.app.camera.fovDeg,60);
  const p=projectSpace(earth.positionAU,f.app.camera,width,height);assert.ok(p.visible&&Math.hypot(p.x-width/2,p.y-height/2)<1e-4);
 }finally{await f.close();}
});
test('menu/search fly-to change world observer position, never open standalone planet modal',async()=>{
 const f=await setup();try{f.app.setDate('2026-10-14T03:37:00Z');f.tick();for(const id of ['moon','mars','saturn','neptune','earth']){
  const old=f.app.camera;f.el('space-objects').click();f.el('space-body-list').querySelector(`[data-space-body=${id}]`).click();f.settle();assert.equal(f.app.selected,id);assert.equal(f.el('space-objects-dialog').open,false);assert.ok(positionDistance(old.positionAU,f.app.camera.positionAU)>1e-7);const b=f.app.snapshot.bodies.find((b:any)=>b.id===id);const p=projectSpace(b.positionAU,f.app.camera,f.width,f.height);assert.ok(p.visible);assert.equal(f.d.querySelectorAll('canvas').length,1);
 }
 f.search('地球');assert.ok(f.el('space-results').querySelector('[data-target=earth]'));f.search('Sirius');const star=f.el('space-results').querySelector('button');assert.ok(star);star.click();f.settle();assert.equal(f.app.selected,'hyg-32263');assert.ok(Math.hypot(...f.app.camera.positionAU)>100000);assert.match(f.el('space-object-note').textContent,/未提供真实恒星表面/);assert.equal(f.app.snapshot.bodies.length,10);
 }finally{await f.close();}
});
test('spatial marker and body labels use the exact current frame observer projection',async()=>{
 const f=await setup();try{f.app.setDate('2026-10-14T03:37:00Z');f.tick();f.el('space-pause').click();f.pointer('pointerdown',1,600,400);
 for(let i=0;i<60;i++){f.pointer('pointermove',1,600+i*2,400+i*.5);f.tick(8.333);const b=f.app.snapshot.bodies.find((b:any)=>b.id==='earth'),p=projectSpace(b.positionAU,f.app.camera,f.width,f.height);const transform=f.el('space-crosshair').style.transform;const match=/translate\(([^p]+)px,\s*([^p]+)px\)/.exec(transform);assert.ok(match);assert.ok(Math.hypot(Number(match[1])-p.x,Number(match[2])-p.y)<1e-5);}
 f.pointer('pointerup',1,718,429.5);f.el('space-label-toggle').click();f.tick();assert.equal([...f.d.querySelectorAll('.space-label')].some(e=>!(e as any).hidden),false);
 const stored=f.w.localStorage.getItem('galaxy-space-v1');assert.ok(stored);assert.equal(f.w.localStorage.getItem('galaxy-allsky-v2'),null,'no prior viewer preference overwrite');
 }finally{await f.close();}
});
test('Earth/Sun remain in a physical changing scene when time advances, and controls do not trap flight keys',async()=>{
 const f=await setup();try{f.app.setDate('2026-10-14T03:37:00Z');f.tick();const earth0=plain(f.app.snapshot.bodies.find((b:any)=>b.id==='earth').positionAU);for(const rate of [1,2,5]){f.el('space-forward').click();assert.equal(f.app.speed,rate);}for(let i=0;i<20&&f.app.speed<3600;i++)f.el('space-forward').click();assert.equal(f.app.speed,3600);for(let i=0;i<30;i++)f.tick(100);assert.ok(positionDistance(earth0,f.app.snapshot.bodies.find((b:any)=>b.id==='earth').positionAU)>1e-5);
 f.el('space-pause').click();f.tick();f.key('keydown','KeyW','w');f.el('space-help').click();const pos=f.app.camera;for(let i=0;i<10;i++)f.tick();assert.deepEqual(plain(f.app.camera.positionAU),plain(pos.positionAU),'opening dialog clears held movement inputs');
 }finally{await f.close();}
});

for(const [width,height] of [[1200,800],[390,844]])test(`selected focus is a light cross and follows the target through zoom/drag at ${width}x${height}`,async()=>{
 const f=await setup(width,height);try{
  const css=await readFile(root+'src/space/style.css','utf8');const style=f.d.createElement('style');style.textContent=css;f.d.head.appendChild(style);
  const marker=f.el('space-crosshair'),computed=f.w.getComputedStyle(marker);
  assert.equal(marker.dataset.focusShape,'perimeter-cross');assert.equal(marker.dataset.focusSizing,'outside-projected-limb');assert.equal(marker.getAttribute('aria-hidden'),'true');
  assert.equal(computed.width,'48px');assert.equal(computed.height,'48px');assert.equal(computed.pointerEvents,'none');assert.equal(computed.borderRadius,'0px');
  const mainRule=css.match(/#space-crosshair\{([^}]+)\}/)![1];assert.match(mainRule,/border:0(?:;|$)/);assert.doesNotMatch(mainRule,/border-radius:50%/);
  assert.doesNotMatch(css,/#space-crosshair::before|#space-crosshair::after/,'no center-spanning cross arms');
  assert.equal(marker.querySelectorAll('[data-focus-edge]').length,4);
  for(const edge of ['top','bottom'])assert.match(css,new RegExp('data-focus-edge="'+edge+'"\\]\\{[^}]*width:1px;height:10px'));
  for(const edge of ['left','right'])assert.match(css,new RegExp('data-focus-edge="'+edge+'"\\]\\{[^}]*width:10px;height:1px'));
  f.app.setDate('2026-10-14T09:55:00Z');f.tick();
  const aligned=()=>{const b=f.app.snapshot.bodies.find((b:any)=>b.id===f.app.selected),p=projectSpace(b.positionAU,f.app.camera,width,height);const t=/translate\(([^p]+)px,\s*([^p]+)px\)/.exec(marker.style.transform);
   const ratio=b.radiusKm/AU_KM/p.distanceAU,radius=height*ratio/(2*Math.sqrt(1-ratio*ratio)*Math.tan(f.app.camera.fovDeg*Math.PI/360)),expected=2*Math.max(8,radius)+32;
   if(p.visible&&!marker.hidden){assert.ok(t);assert.ok(Math.hypot(Number(t[1])-p.x,Number(t[2])-p.y)<1e-5);assert.ok(Math.abs(parseFloat(f.w.getComputedStyle(marker).width)-expected)<1e-5);assert.equal(marker.style.width,marker.style.height);
    for(const el of marker.querySelectorAll('[data-focus-edge]')){const edge=el.dataset.focusEdge;const dx=edge==='left'?-expected/2:edge==='right'?expected/2-10:-.5,dy=edge==='top'?-expected/2:edge==='bottom'?expected/2-10:-.5;const w=edge==='top'||edge==='bottom'?1:10,h=edge==='top'||edge==='bottom'?10:1;assert.ok(Math.hypot(Math.max(dx,Math.min(0,dx+w)),Math.max(dy,Math.min(0,dy+h)))>=radius+6-1e-5);}
   }
  };
  aligned();for(let i=0;i<2;i++){f.el('space-nearer').click();f.tick(8.333);aligned();}
  f.pointer('pointerdown',901,width/2,height/2);for(let i=1;i<=30;i++){f.pointer('pointermove',901,width/2+i*2,height/2+i*.4);f.tick(16.667);aligned();}f.pointer('pointerup',901,width/2+60,height/2+12);
  f.el('space-label-toggle').click();f.tick();assert.equal(f.app.options.labels,false);assert.equal(marker.hidden,false,'focus is independent of name toggle');aligned();
  const chosen=f.app.selected;f.el('space-mode').click();f.pointer('pointerdown',902,width/2,height/2);f.pointer('pointermove',902,width/2+height*3,height/2);f.pointer('pointerup',902,width/2+height*3,height/2);f.tick();assert.equal(f.app.selected,chosen);assert.equal(marker.hidden,true,'hide marker for a target behind camera');
  f.el('space-earth').click();f.tick();aligned();assert.equal(marker.hidden,false);
  assert.equal(f.el('observer-mode-link'),null);assert.equal(f.el('space-cinematic'),null);assert.equal(f.app.options.cinematic,true);
 }finally{await f.close();}
});

test('focus scales with the rendered Earth diameter, not a fixed icon size',async()=>{
 const f=await setup(1200,800);try{
  const style=f.d.createElement('style');style.textContent=await readFile(root+'src/space/style.css','utf8');f.d.head.appendChild(style);
  f.app.setDate('2026-10-14T10:19:00Z');f.tick();
  const marker=f.el('space-crosshair'),size=()=>parseFloat(f.w.getComputedStyle(marker).width);
  const start=size();f.el('space-nearer').click();f.tick(8.333);const near=size();
  assert.ok(near>start,`cross must grow on the SAME next frame: before=${start}, after=${near}`);
  f.el('space-farther').click();f.tick(16.667);assert.ok(Math.abs(size()-start)<1e-5,'moving back restores the proportional size');
 }finally{await f.close();}
});

test('object panel omits redundant orbit action while go-to, drag orbit and toolbar mode switching remain usable',async()=>{
 const f=await setup(1200,800);try{
  f.app.setDate('2026-10-14T10:27:00Z');f.tick();f.app.select('neptune');f.settle();
  const panel=f.el('space-object');assert.equal(panel.hidden,false);assert.equal(f.el('space-orbit'),null);
  assert.deepEqual(Array.from(panel.querySelectorAll('.object-actions button'),(b:any)=>b.id),['space-go']);
  assert.ok(f.el('space-mode'),'toolbar retains mode control');assert.equal(f.app.view.mode,'orbit');
  f.el('space-mode').click();f.tick();assert.equal(f.app.view.mode,'free');
  f.el('space-go').click();assert.equal(f.app.view.mode,'orbit','go-to already selects orbit mode');f.settle();
  const before=f.app.camera.positionAU;f.pointer('pointerdown',990,600,400);f.pointer('pointermove',990,650,425);f.pointer('pointerup',990,650,425);f.tick();
  assert.ok(positionDistance(before,f.app.camera.positionAU)>1e-8,'drag still orbits spatial target');
  f.el('space-mode').click();f.tick();assert.equal(f.app.view.mode,'free');f.el('space-mode').click();f.tick();assert.equal(f.app.view.mode,'orbit');
  for(let i=0;i<30;i++)f.tick(16.667);assert.equal(f.el('space-orbit'),null,'no periodic reconstruction');
  assert.equal(f.app.options.cinematic,true);assert.equal(f.el('observer-mode-link'),null);
  const source=await readFile(root+'src/space/app.ts','utf8');assert.doesNotMatch(source,/space-orbit/);
 }finally{await f.close();}
});

for(const [width,height]of[[1200,800],[390,844]])test(`flight controls have spatial direction groups and nonwrapping front/back labels ${width}x${height}`,async()=>{
 const f=await setup(width,height);try{
  const css=await readFile(root+'src/space/style.css','utf8'),style=f.d.createElement('style');style.textContent=css;f.d.head.appendChild(style);
  const directions=f.d.querySelector('.move-direction-pad')!,depth=f.d.querySelector('.move-depth-pad')!;
  assert.deepEqual(Array.from(directions.querySelectorAll('button'),b=>b.getAttribute('data-move')),['up','left','right','down']);
  assert.deepEqual(Array.from(depth.querySelectorAll('button'),b=>b.getAttribute('data-move')),['forward','back']);
  assert.match(css,/grid-template-areas:"\. up \." "left center right" "\. down \."/);
  for(const id of ['up','down','left','right'])assert.match(css,new RegExp(`\\[data-move="${id}"\\]\\{grid-area:${id}\\}`));
  for(const button of depth.querySelectorAll('button')){assert.equal(f.w.getComputedStyle(button).whiteSpace,'nowrap');assert.ok(['前进','后退'].includes(button.textContent!));assert.equal(button.getAttribute('type'),'button');}
  assert.equal(f.d.querySelectorAll('.move-pad button').length,6);
 }finally{await f.close();}
});

test('speed drag keeps range focus until release, then WASD works immediately on the canvas',async()=>{
 const f=await setup();try{
  f.app.setDate('2026-10-14T10:30:00Z');f.tick();const speed=f.el('space-speed');speed.focus();
  speed.dispatchEvent(new f.w.PointerEvent('pointerdown',{pointerId:777,button:0,bubbles:true}));
  for(const value of ['.25','.5','1']){speed.value=value;speed.dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.equal(f.d.activeElement,speed,'no mid-drag focus steal');}
  speed.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.d.activeElement,speed,'wait until pointer release');
  f.w.dispatchEvent(new f.w.PointerEvent('pointerup',{pointerId:777,button:0,bubbles:true}));assert.equal(f.d.activeElement,f.c);
  assert.match(f.el('space-speed-factor').textContent,/×10/);const before=f.app.camera;
  f.d.activeElement!.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'d',code:'KeyD',bubbles:true,cancelable:true}));for(let i=0;i<6;i++)f.tick(16.667);f.d.activeElement!.dispatchEvent(new f.w.KeyboardEvent('keyup',{key:'d',code:'KeyD',bubbles:true}));
  assert.ok(positionDistance(before.positionAU,f.app.camera.positionAU)>1e-8);assert.equal(f.app.camera.fovDeg,before.fovDeg);assert.equal(f.app.view.mode,'free');assert.equal(f.w.location.pathname,'/space/','focus never navigates');
 }finally{await f.close();}
});

test('keyboard range edit commits on key release; Tab, blur and other focus are respected',async()=>{
 const f=await setup();try{
  const speed=f.el('space-speed'),search=f.el('space-search');speed.focus();
  speed.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));
  for(const value of ['.25','.5']){speed.value=value;speed.dispatchEvent(new f.w.Event('input',{bubbles:true}));speed.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.d.activeElement,speed,'key repeat can finish before returning');}
  speed.dispatchEvent(new f.w.KeyboardEvent('keyup',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));assert.equal(f.d.activeElement,f.c);
  speed.focus();speed.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true}));search.focus();speed.dispatchEvent(new f.w.KeyboardEvent('keyup',{key:'Tab',code:'Tab',bubbles:true}));assert.equal(f.d.activeElement,search);
  speed.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.d.activeElement,search,'background value changes never steal unrelated focus');
  speed.focus();speed.value='1';speed.dispatchEvent(new f.w.Event('input',{bubbles:true}));speed.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.d.activeElement,f.c,'commit without pointer bookkeeping also returns');
  speed.focus();speed.dispatchEvent(new f.w.PointerEvent('pointerdown',{pointerId:778,button:0,bubbles:true}));f.w.dispatchEvent(new f.w.PointerEvent('pointercancel',{pointerId:778,bubbles:true}));assert.equal(f.d.activeElement,f.c);
  speed.focus();speed.dispatchEvent(new f.w.PointerEvent('pointerdown',{pointerId:779,button:0,bubbles:true}));search.focus();f.w.dispatchEvent(new f.w.PointerEvent('pointerup',{pointerId:779,button:0,bubbles:true}));assert.equal(f.d.activeElement,search,'release does not override an intentional focus change');
 }finally{await f.close();}
});

test('all six reorganized movement buttons still move the real camera and stop on release',async()=>{
 const f=await setup();try{
  f.app.setDate('2026-10-14T10:30:00Z');f.tick();
  for(const id of ['up','left','right','down','forward','back']){
   f.el('space-earth').click();f.tick();const before=f.app.camera.positionAU,b=f.d.querySelector(`[data-move=${id}]`)!;
   b.dispatchEvent(new f.w.PointerEvent('pointerdown',{pointerId:808,button:0,bubbles:true,cancelable:true}));for(let i=0;i<5;i++)f.tick(16.667);b.dispatchEvent(new f.w.PointerEvent('pointerup',{pointerId:808,button:0,bubbles:true}));
   assert.ok(positionDistance(before,f.app.camera.positionAU)>1e-8,id);const stopped=f.app.camera.positionAU;for(let i=0;i<3;i++)f.tick();assert.deepEqual(plain(f.app.camera.positionAU),plain(stopped),id+' release clears movement');
  }
 }finally{await f.close();}
});

test('partially offscreen globe retains visible perimeter ticks; a full-screen closeup never clamps them inside',async()=>{
 const f=await setup(1200,800);try{
  const style=f.d.createElement('style');style.textContent=await readFile(root+'src/space/style.css','utf8');f.d.head.appendChild(style);
  f.app.setDate('2026-10-14T10:54:00Z');f.tick();const marker=f.el('space-crosshair');
  for(let i=0;i<10;i++){f.el('space-nearer').click();f.tick(8.333);}
  assert.equal(marker.hidden,true,'when globe edges are all outside the viewport, no tick is moved inward');
  f.el('space-earth').click();f.tick();assert.equal(marker.hidden,false);
  f.el('space-mode').click();f.pointer('pointerdown',950,600,400);let partialVerified=false;
  for(let i=1;i<=50;i++){
   f.pointer('pointermove',950,600-i*16,400);f.tick(8.333);
   const b=f.app.snapshot.bodies.find((b:any)=>b.id==='earth'),p=projectSpace(b.positionAU,f.app.camera,1200,800),ratio=b.radiusKm/AU_KM/p.distanceAU;
   const radius=800*ratio/(2*Math.sqrt(1-ratio*ratio)*Math.tan(f.app.camera.fovDeg*Math.PI/360));
   if(p.x<0&&p.x+radius+16>0&&p.y>=0&&p.y<800){
    assert.equal(marker.hidden,false,'right limb tick stays visible when body center has left view');assert.equal(marker.querySelector('[data-focus-edge="left"]').hidden,true);assert.equal(marker.querySelector('[data-focus-edge="right"]').hidden,false);partialVerified=true;break;
   }
  }
  f.pointer('pointerup',950,0,400);assert.ok(partialVerified,'test exercised an actual offscreen-center limb');
  f.el('space-earth').click();f.tick();assert.equal(marker.hidden,false);for(const t of marker.querySelectorAll('[data-focus-edge]'))assert.equal(t.hidden,false,'return restores every visible tick');
 }finally{await f.close();}
});


test('fine spatial time buttons advance gently, reverse through pause and preserve resume/Now',async()=>{
 const f=await setup(1000,700);try{
  f.app.setDate('2026-10-14T00:00:00Z');f.tick();assert.equal(f.app.speed,0);
  for(const rate of [1,2,5,10,20,30,60]){f.el('space-forward').click();assert.equal(f.app.speed,rate);assert.equal(f.el('space-time-speed').textContent,`${rate}×`);}
  f.el('space-pause').click();assert.equal(f.app.speed,0);f.el('space-pause').click();assert.equal(f.app.speed,60);
  for(const rate of [30,20,10,5,2,1,0,-1,-2]){f.el('space-rewind').click();assert.equal(f.app.speed,rate);}
  assert.match(f.el('space-time-speed').getAttribute('aria-label'),/倒退2秒/);
  const selected=f.app.selected,camera=plain(f.app.camera);f.el('space-now').click();assert.equal(f.app.speed,1);assert.equal(f.app.selected,selected);assert.deepEqual(plain(f.app.camera),camera);
  const epoch=f.app.snapshot.date.getTime();f.el('space-forward').click();assert.equal(f.app.speed,2);f.tick(100);f.tick(100);f.tick(100);assert.ok(f.app.snapshot.date.getTime()>epoch);
 }finally{await f.close();}
});

for(const [width,height]of [[1000,700],[390,844]])test(`spacecraft information dialog preserves camera/time and restores focus ${width}x${height}`,async()=>{
 const f=await setup(width,height);try{
  if(f.app.speed!==0)f.el('space-pause').click();f.tick();const before=plain(f.app.camera),selected=f.app.selected,speed=f.app.speed,launcher=f.el('space-spacecraft'),dialog=f.el('space-spacecraft-dialog');launcher.focus();launcher.click();assert.equal(dialog.open,true);const input=dialog.querySelector('[data-spacecraft-action="search"]');assert.ok(f.d.activeElement===input);assert.equal(f.el('spacecraft-library').dataset.spacecraftCount,'12');assert.equal(dialog.querySelectorAll('img,iframe,canvas').length,0);
  input.value='Juno';input.dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.equal(dialog.querySelectorAll('article').length,1);assert.equal(dialog.querySelector('article').dataset.spacecraftId,'juno');
  for(const [key,code] of [['w','KeyW'],[' ','Space']])input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true}));for(let i=0;i<5;i++)f.tick();assert.deepEqual(plain(f.app.camera),before);assert.equal(f.app.selected,selected);assert.equal(f.app.speed,speed);
  dialog.dispatchEvent(new f.w.Event('cancel',{cancelable:true}));assert.equal(dialog.open,false);assert.ok(f.d.activeElement===launcher);for(let i=0;i<5;i++)f.tick();assert.deepEqual(plain(f.app.camera),before,'no held movement leaked after dismissal');
  launcher.click();assert.equal(f.el('spacecraft-library').dataset.spacecraftCount,'12');assert.equal(input.value,'');dialog.querySelector('[data-space-close]').click();assert.equal(dialog.open,false);assert.ok(f.d.activeElement===launcher);
 }finally{await f.close();}
});
test('related spacecraft entry follows real selected bodies, is absent for unmatched stars, and disposes with the app',async()=>{
 const f=await setup();try{
  if(f.app.speed!==0)f.el('space-pause').click();f.tick();f.app.select('moon');f.settle();let related=f.el('space-related-spacecraft');assert.equal(related.hidden,false);related.focus();related.click();const dialog=f.el('space-spacecraft-dialog');assert.equal(dialog.open,true);assert.equal(f.el('spacecraft-library').dataset.spacecraftBody,'moon');assert.ok(dialog.querySelector('[data-spacecraft-id="change-6"]'));assert.equal(dialog.querySelector('[data-spacecraft-id="juno"]'),null);dialog.querySelector('[data-space-close]').click();assert.ok(f.d.activeElement===related);
  f.search('Ruchbah');f.el('space-results').querySelector('[data-target="hyg-6672"]').click();f.settle();assert.equal(related.hidden,true);f.el('space-spacecraft').click();assert.equal(dialog.open,true);f.app.dispose();assert.equal(dialog.open,false);assert.equal(f.el('spacecraft-library').children.length,0);f.el('space-spacecraft').click();assert.equal(dialog.open,false);
 }finally{await f.close();}
});
