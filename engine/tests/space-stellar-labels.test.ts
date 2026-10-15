// Real 9,078-record catalog, astronomy, navigation and app. Synthetic DOM and
// recording renderer: scheduling/geometry/wiring evidence, NOT browser pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
import {StellarLabelPlanner, StarLabels, labelProjector, overlaps, STAR_LABEL_REFRESH_MS, type LabelFrame, type StarLabelPlacement} from '../src/space/labels';
import {AU_KM, PARSEC_AU, type CatalogStar3D, type SpaceCamera, type SpaceSnapshot, type Vec3} from '../src/space/types';
import {projectSpace, starMagnitude} from '../src/space/render-math';
import {getStellarModel} from '../src/space/stellar-model';
const root=fileURLToPath(new URL('../',import.meta.url));
const currentApp=fileURLToPath(new URL('../src/space/app.ts',import.meta.url));
const historicalApp=fileURLToPath(new URL('./fixtures/historical/full-rotation-app.ts',import.meta.url));
const spaceSource=fileURLToPath(new URL('../src/space/',import.meta.url));
const renderMath=fileURLToPath(new URL('../src/space/render-math.ts',import.meta.url));
const raw=JSON.parse(await readFile(root+'public/data/space-stars.json','utf8'));
const stars:CatalogStar3D[]=raw.stars;
const sirius=stars.find(s=>s.id==='hyg-32263')!;
const dim=stars.find(s=>s.id==='hyg-82472')!; // HIP 82724, genuinely faint from Sun.
const english=stars.find(s=>s.name==='Ross 128')!;
const cameraTo=(s:CatalogStar3D,positionAU:Vec3=[0,0,0],rollDeg=0):SpaceCamera=>{
 const v=s.positionAU.map((n,i)=>n-positionAU[i]),d=Math.hypot(...v);
 return {positionAU,azimuthDeg:Math.atan2(v[0],-v[2])*180/Math.PI,altitudeDeg:Math.asin(v[1]/d)*180/Math.PI,rollDeg,fovDeg:60};
};
const empty:SpaceSnapshot={date:new Date('2026-10-14T12:31:00Z'),bodies:[]};
const frame=(overrides:Partial<LabelFrame>={}):LabelFrame=>({camera:cameraTo(sirius),snapshot:empty,width:1200,height:800,now:0,selectedId:null,enabled:true,bodyLabels:[],obstacles:[],...overrides});
// Independent rotation-matrix / pinhole oracle, not projectSpace/labelProjector.
function oracle(position:number[],c:SpaceCamera,w:number,h:number){
 const a=c.azimuthDeg*Math.PI/180,t=c.altitudeDeg*Math.PI/180,r=(c.rollDeg??0)*Math.PI/180;
 const f=[Math.cos(t)*Math.sin(a),Math.sin(t),-Math.cos(t)*Math.cos(a)];
 const upright=[-Math.sin(a)*Math.sin(t),Math.cos(t),Math.cos(a)*Math.sin(t)],right=[Math.cos(a),0,Math.sin(a)];
 const R=right.map((n,i)=>n*Math.cos(r)+upright[i]*Math.sin(r)),U=upright.map((n,i)=>n*Math.cos(r)-right[i]*Math.sin(r));
 const v=position.map((n,i)=>n-c.positionAU[i]),dot=(u:number[])=>u.reduce((n,k,i)=>n+k*v[i],0),z=dot(f),distance=Math.hypot(...v),scale=h/2/Math.tan(c.fovDeg*Math.PI/360);
 const x=w/2+dot(R)/z*scale,y=h/2-dot(U)/z*scale;
 return {x,y,distance,visible:z/distance>1e-15&&x>=0&&y>=0&&x<=w&&y<=h};
}
function assertLayout(labels:StarLabelPlacement[],f:LabelFrame){
 assert.ok(labels.length<=(f.width<=700?24:48));
 for(let i=0;i<labels.length;i++){
  const p=labels[i],star=stars.find(s=>s.id===p.id);if(star){const expected=oracle(star.positionAU,f.camera,f.width,f.height);assert.ok(expected.visible);assert.ok(Math.hypot(p.anchor.x-expected.x,p.anchor.y-expected.y)<1e-6);}
  assert.ok(p.x>=4&&p.y>=4&&p.x+p.width<=f.width-4&&p.y+p.height<=f.height-4);
  for(let j=0;j<i;j++)assert.equal(overlaps(p,labels[j]),false,`${p.id}/${labels[j].id}`);
  for(const o of [...f.obstacles,...f.bodyLabels])assert.equal(overlaps(p,o),false);
 }
}

test('full real catalog yields bounded ordinary labels and unchanged Chinese / English / identifier names',()=>{
 assert.equal(stars.length,9078);assert.equal(stars.filter(s=>s.nameZh).length,12);
 const planner=new StellarLabelPlanner(stars);
 for(const star of [sirius,english,dim,stars.find(s=>/^Gl /.test(s.name))!,stars.find(s=>/^HYG /.test(s.name))!].filter(Boolean)){
  const f=frame({camera:cameraTo(star),selectedId:star.id});const labels=planner.plan(f),chosen=labels.find(p=>p.id===star.id);
  assert.ok(chosen,star.id);assert.equal(chosen.text,star.nameZh||star.name);assertLayout(labels,f);
 }
 assert.ok(starMagnitude(dim,Math.hypot(...dim.positionAU))>8.7);
 const ordinary=planner.plan(frame({camera:cameraTo(dim),selectedId:null}));assert.ok(!ordinary.some(p=>p.id===dim.id));
 const visible=planner.plan(frame({selectedId:null,now:151}));assert.ok(visible.length>5);assert.ok(planner.stats.candidates<=144);
});

test('apparent brightness is recomputed from moving camera; absolute/Solar rank is not reused',()=>{
 const near:CatalogStar3D={...dim,id:'faint-near-fixture',name:'HIP fixture',positionAU:[0,0,-PARSEC_AU],absoluteMagnitude:16};
 const bright:CatalogStar3D={...sirius,id:'bright-far-fixture',name:'HIP other',positionAU:[100*PARSEC_AU,0,-100*PARSEC_AU],absoluteMagnitude:-1};
 const planner=new StellarLabelPlanner([near,bright]),start=frame({camera:{positionAU:[0,0,0],azimuthDeg:0,altitudeDeg:0,fovDeg:90}});
 assert.ok(!planner.plan(start).some(p=>p.id===near.id));
 const moved=frame({camera:cameraTo(near,[0,0,-PARSEC_AU+100]),now:151});
 const labels=planner.plan(moved);assert.equal(labels[0].id,near.id);assert.ok(starMagnitude(near,100)<0);
});

test('selected dim ID bypasses ranking immediately, while membership stays cached 150ms',()=>{
 const planner=new StellarLabelPlanner(stars);let f=frame({camera:cameraTo(dim)});planner.plan(f);const before=planner.stats.rebuilds;
 f={...f,now:8.333,selectedId:dim.id};assert.ok(planner.plan(f).some(p=>p.id===dim.id));assert.equal(planner.stats.rebuilds,before+1);
 for(let i=1;i<=17;i++)planner.plan({...f,now:8.333+i*8.333,camera:{...f.camera,rollDeg:i*3}});
 assert.equal(planner.stats.rebuilds,before+1);assert.ok(planner.stats.projected<=145);
 planner.plan({...f,now:160});assert.equal(planner.stats.rebuilds,before+2);
 planner.plan({...f,enabled:false,now:161});planner.plan({...f,now:162});assert.equal(planner.stats.rebuilds,before+3,'toggle invalidates membership');
 planner.plan({...f,width:390,height:844,now:163});assert.equal(planner.stats.rebuilds,before+4,'resize invalidates membership');
});

test('roll-aware projection matches independent oracle for translated cameras, poles and both DPR-independent CSS sizes',()=>{
 for(const [w,h] of [[1200,800],[390,844],[844,390]])for(const a of [-270,-90,0,94,270])for(const pitch of [-179,-91,-90,89,91,179])for(const roll of [-153,0,78]){
  const c:SpaceCamera={positionAU:[123,-456,789],azimuthDeg:a,altitudeDeg:pitch,rollDeg:roll,fovDeg:60},project=labelProjector(c,w,h);
  for(const s of [sirius,dim,english]){const p=project(s.positionAU),o=oracle(s.positionAU,c,w,h),r=projectSpace(s.positionAU,c,w,h);assert.equal(p.visible,o.visible);assert.equal(p.visible,r.visible);if(p.visible){assert.ok(Math.hypot(p.x-o.x,p.y-o.y)<1e-6);assert.ok(Math.hypot(p.x-r.x,p.y-r.y)<1e-6);}}
 }
});

test('every sub-refresh frame reprojects/rechecks collisions, behind/offscreen and brightness, with no stale labels',()=>{
 const planner=new StellarLabelPlanner(stars),base=frame({selectedId:sirius.id}),first=planner.plan(base),rebuilds=planner.stats.rebuilds;
 assert.ok(first.some(p=>p.id===sirius.id));let moving=0;
 for(let i=1;i<=16;i++){
  const f={...base,now:i*8.333,camera:{...base.camera,azimuthDeg:base.camera.azimuthDeg+i*.2,rollDeg:i*5}};
  const labels=planner.plan(f);assertLayout(labels,f);const p=labels.find(p=>p.id===sirius.id)!;assert.ok(p);if(Math.abs(p.anchor.x-600)>1)moving++;
 }
 assert.equal(moving,16);assert.equal(planner.stats.rebuilds,rebuilds);
 for(const delta of [85,180]){const f={...base,now:140,camera:{...base.camera,azimuthDeg:base.camera.azimuthDeg+delta,altitudeDeg:delta===180?-base.camera.altitudeDeg:base.camera.altitudeDeg}};assert.ok(!planner.plan(f).some(p=>p.id===sirius.id));}
 assert.ok(planner.plan({...base,now:145}).some(p=>p.id===sirius.id),'returns immediately without rebuild');
});

test('physical rendered disks occult anchors and exclude text, including off-axis disks, not a guessed angular diameter',()=>{
 const position:Vec3=[.3,0,-1],s:CatalogStar3D={...sirius,positionAU:position.map(n=>n*10) as Vec3};
 const planet={id:'earth',name:'地球',nameEn:'Earth',kind:'planet' as const,positionAU:position,radiusKm:.2*AU_KM,color:'#fff',textureId:'earth',axisNorth:[0,1,0] as Vec3,axisPrime:[1,0,0] as Vec3,axisEast:[0,0,1] as Vec3};
 const f=frame({camera:{positionAU:[0,0,0],azimuthDeg:0,altitudeDeg:0,rollDeg:65,fovDeg:60},snapshot:{...empty,bodies:[planet]},selectedId:s.id});
 const planner=new StellarLabelPlanner([s]);assert.equal(planner.plan(f).length,0,'behind real sphere');
 assert.equal(planner.plan({...f,now:8,snapshot:empty}).length,1,'unocculted in SAME next frame');
 const foreground={...s,positionAU:position.map(n=>n*.1) as Vec3};assert.equal(new StellarLabelPlanner([foreground]).plan(f).length,1,'foreground star not incorrectly hidden');
 // Exact renderer circle is radius h/2/tan(FOV/2) * r/sqrt(d*d-r*r).
 const textFrame={...f,camera:{...f.camera,rollDeg:0}};
 const p=oracle(position,textFrame.camera,f.width,f.height),radius=f.height/2/Math.tan(Math.PI/6)*.2/Math.sqrt(1.09-.04);
 const beside={...s,positionAU:[.09,0,-1] as Vec3},list=new StellarLabelPlanner([beside]).plan({...textFrame,selectedId:beside.id});
 assert.equal(list.length,1,'a visible star beside the limb keeps a readable label');
 assert.ok(list[0].x+list[0].width<list[0].anchor.x,'default right-side text would cross the disk, so it moves left');
 for(const r of list){const dx=p.x-Math.max(r.x,Math.min(p.x,r.x+r.width)),dy=p.y-Math.max(r.y,Math.min(p.y,r.y+r.height));assert.ok(Math.hypot(dx,dy)>radius+2);}
});

function denseStars():CatalogStar3D[]{
 return Array.from({length:9078},(_,i)=>{const positionAU:Vec3=[((i%18)-8.5)*.09,(Math.floor(i/18)%14-6.5)*.075,-1];return {...sirius,id:`fixture-${i}`,name:`HIP ${i}`,nameZh:undefined,positionAU,absoluteMagnitude:2-5*Math.log10(Math.hypot(...positionAU)/PARSEC_AU/10)};});
}
test('density saturates 24/48 without label/solar/UI overlap and prioritizes selected dim catalog ID',()=>{
 const data=denseStars(),planner=new StellarLabelPlanner(data);
 for(const [width,height]of[[1200,800],[390,844]]){
  const f=frame({width,height,camera:{positionAU:[0,0,0],azimuthDeg:0,altitudeDeg:0,fovDeg:60},bodyLabels:[{x:width/2,y:height/2,width:80,height:22}],obstacles:[{x:0,y:0,width,height:100}]});
  const labels=planner.plan(f);assert.equal(labels.length,width>700?48:24);assertLayout(labels,f);
  const last=[...data].reverse().find(s=>Math.abs(s.positionAU[0])<.05&&Math.abs(s.positionAU[1])<.04)!;last.absoluteMagnitude=40;
  const selected=planner.plan({...f,now:1,selectedId:last.id});assert.equal(selected[0].id,last.id);assert.equal(selected[0].selected,true);assertLayout(selected,f);
 }
});

test('UI obstacle reads are batched/cached, focused node identity stable and pool/disposal bounded',async()=>{
 const w=new Window({width:1200,height:800}),d=w.document;d.body.innerHTML='<div class="journey-heading"></div><div id="labels"></div>';
 let reads=0;const panel=d.querySelector('.journey-heading')!;panel.getBoundingClientRect=()=>{reads++;return {left:0,top:0,width:1200,height:70} as DOMRect;};
 const ui=new StarLabels(d.getElementById('labels')! as any,denseStars(),()=>{}),f=frame({camera:{positionAU:[0,0,0],azimuthDeg:0,altitudeDeg:0,fovDeg:60}});
 for(let i=0;i<17;i++){const now=i*8.333;ui.update({...f,now,obstacles:ui.readObstacles(now,1200,800)});}assert.equal(reads,1);assert.equal(d.querySelectorAll('button').length,48);
 const held=d.querySelector('button') as any,id=held.dataset.target;held.focus();ui.update({...f,now:140,selectedId:id});assert.equal(d.activeElement,held);assert.equal(held.dataset.target,id);
 ui.invalidateLayout();ui.readObstacles(141,1200,800);assert.equal(reads,2);
 for(let i=0;i<100;i++){const width=i%2?390:1200,height=i%2?844:800;ui.update({...f,width,height,now:200+i*151,camera:{...f.camera,rollDeg:i*10}});assert.ok(d.querySelectorAll('button').length<=48);assert.ok([...d.querySelectorAll('button')].filter((b:any)=>!b.hidden).length<=(width<=700?24:48));}
 ui.update({...f,enabled:false,now:20000});assert.ok([...d.querySelectorAll('button')].every((b:any)=>b.hidden));ui.dispose();assert.equal(d.querySelectorAll('button').length,0);ui.dispose();await w.happyDOM.abort();
});

const bundles=new Map<string,Promise<string>>();
function bundle(appEntry=currentApp){
 let value=bundles.get(appEntry);if(!value){value=build({absWorkingDir:root,stdin:{contents:`import {startSpace} from ${JSON.stringify(appEntry)}; startSpace().then(app=>window.__labelInstance=app);`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',plugins:[{name:'record-renderer-only',setup(b){
 b.onResolve({filter:/^\.\/renderer$/},a=>a.importer===appEntry?{path:'renderer',namespace:'record'}:undefined);
 // Use the same installed astronomy dependency as the Node-side assertions.
 b.onResolve({filter:/^astronomy-engine$/},()=>({path:fileURLToPath(import.meta.resolve('astronomy-engine'))}));
 // Keep the historical app byte-for-byte intact. Resolve only its imports as
 // if it lived in this checkout's src/space; no historical release is loaded.
 b.onResolve({filter:/^\.\.?\//},a=>a.importer===historicalApp?b.resolve(a.path,{resolveDir:spaceSource,kind:a.kind}):undefined);
 b.onLoad({filter:/.*/,namespace:'record'},()=>({contents:`import {projectSpace} from ${JSON.stringify(renderMath)};export class SpaceRenderer{constructor(c){this.c=c;}async init(){}render(snapshot,view){window.__lastRendered={camera:JSON.parse(JSON.stringify(view.camera)),date:snapshot.date.toISOString()};}project(p,c){return projectSpace(p,c,this.c.clientWidth,this.c.clientHeight);}pick(){window.__picks=(window.__picks||0)+1;return 'earth';}getStats(){return {status:'recorded protocol'};}dispose(){}}`,loader:'ts',resolveDir:root}));
 }}]}).then(b=>b.outputFiles[0].text);bundles.set(appEntry,value);}return value;
}
async function fixture(appEntry=currentApp){
 const w=new Window({width:1200,height:800,url:'https://example.test/'}),d=w.document;d.write(await readFile(root+'src/modes/space.html','utf8'));
 const style=d.createElement('style');style.textContent=await readFile(root+'src/space/style.css','utf8');d.head.appendChild(style);
 w.fetch=(async()=>({ok:true,json:async()=>raw})) as any;Object.defineProperty(d,'hidden',{value:false});
 const c=d.getElementById('space-canvas') as any;let width=1200,height=800;Object.defineProperties(c,{clientWidth:{get:()=>width},clientHeight:{get:()=>height}});
 const captures=new Set<number>();c.setPointerCapture=(id:number)=>captures.add(id);c.hasPointerCapture=(id:number)=>captures.has(id);c.releasePointerCapture=(id:number)=>captures.delete(id);
 let next:FrameRequestCallback|undefined,now=w.performance.now();w.requestAnimationFrame=(fn:FrameRequestCallback)=>{next=fn;return 1;};w.cancelAnimationFrame=()=>{next=undefined;};w.eval(await bundle(appEntry));
 for(let i=0;i<80&&!(w as any).__labelInstance;i++)await new Promise<void>(r=>setImmediate(r));assert.equal(d.body.dataset.spaceReady,'true');
 const app=(w as any).__space,instance=(w as any).__labelInstance,el=(id:string)=>d.getElementById(id) as any;
 const tick=(ms=8.333)=>{now+=ms;const fn=next;next=undefined;assert.ok(fn);fn(now);assert.equal(d.body.dataset.spaceReady,'true',el('space-loading-text').textContent);};
 const settle=()=>{for(let i=0;i<36;i++)tick(100);};
 const pointer=(type:string,id:number,x:number,y:number,target=c)=>target.dispatchEvent(new w.PointerEvent(type,{pointerType:'touch',pointerId:id,clientX:x,clientY:y,button:0,bubbles:true}));
 const labels=()=>[...d.querySelectorAll<HTMLButtonElement>('.space-star-label')].filter(b=>!b.hidden);
 const resize=(widthIn:number,heightIn:number,dpr:number)=>{width=widthIn;height=heightIn;Object.defineProperty(w,'devicePixelRatio',{value:dpr,configurable:true});w.dispatchEvent(new w.Event('resize'));};
 const pause=()=>{if(app.speed)el('space-pause').click();};
 return {w,d,c,app,instance,el,tick,settle,pointer,labels,resize,pause,size:()=>[width,height],close:async()=>{app.dispose();assert.equal(next,undefined);await w.happyDOM.abort();}};
}
function labelAnchor(b:any){const m=/translate\(([-+.\deE]+)px,\s*([-+.\deE]+)px\)/.exec(b.style.transform);assert.ok(m);return [+m[1],+m[2]];}
function assertDOMFrame(f:Awaited<ReturnType<typeof fixture>>){
 const [width,height]=f.size(),camera=(f.w as any).__lastRendered.camera;
 assert.equal((f.w as any).__lastRendered.date,f.app.snapshot.date.toISOString());
 const boxes=f.labels().map(b=>{const s=stars.find(s=>s.id===b.dataset.target)!;assert.ok(s);assert.equal(b.textContent,s.nameZh||s.name);const p=oracle(s.positionAU,camera,width,height);assert.ok(p.visible);const [x,y]=labelAnchor(b),w=parseFloat(b.style.width),h=22;
  // Each accepted label uses one of the declared local anchor placements.
  // The new authorized stellar surface has a model radius. Calculate its
  // projected limb independently rather than reusing the focus/label helper.
  const m=getStellarModel(s),range=Math.hypot(...s.positionAU.map((v,i)=>v-camera.positionAU[i]));
  const limb=m?height*Math.tan(Math.asin(m.radiusKm/AU_KM/range))/(2*Math.tan(camera.fovDeg*Math.PI/360)):0;
  const half=Math.max(8,limb)+16,gap=b.dataset.selected==='true'?half+4:8;
  const dx=x-p.x,dy=y-p.y,validX=[gap,-w-gap,-w/2],validY=[-11,-22-gap,gap];assert.ok(validX.some(v=>Math.abs(dx-v)<1e-5)&&validY.some(v=>Math.abs(dy-v)<1e-5),`${s.id} ${dx}/${dy}`);
  if(b.dataset.selected==='true')assert.equal(overlaps({x,y,width:w,height:h},{x:p.x-half,y:p.y-half,width:half*2,height:half*2}),false,'selected text stays outside actual model-sized perimeter locator');
  return {x,y,width:w,height:h};});
 for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++)assert.equal(overlaps(boxes[i],boxes[j]),false);
 assert.ok(boxes.length<=(width<=700?24:48));assert.ok(f.d.querySelectorAll('.space-label').length<=58);
}

test('historical negative-control fixtures match their verbatim source provenance',async()=>{
 const directory=new URL('./fixtures/historical/',import.meta.url);
 const provenance=JSON.parse(await readFile(new URL('PROVENANCE.json',directory),'utf8'));
 assert.deepEqual(provenance.artifacts.map((artifact:any)=>artifact.fixture),['full-rotation-app.ts','stellar-closeup-shaders.ts']);
 for(const artifact of provenance.artifacts){
  const bytes=await readFile(fileURLToPath(new URL(artifact.fixture,directory)));
  assert.equal(bytes.length,artifact.bytes,artifact.fixture);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256,artifact.fixture);
 }
});

test('actual previous source reproduces missing Sirius label; revised app exposes real star labels without forging planets',async()=>{
 const old=await fixture(historicalApp);try{old.app.select(sirius.id);old.settle();assert.ok(oracle(sirius.positionAU,old.app.camera,1200,800).visible);assert.equal(old.d.querySelectorAll('.space-label').length,10);assert.ok(![...old.d.querySelectorAll('.space-label')].some(b=>b.textContent==='天狼星'));}finally{await old.close();}
 const f=await fixture();try{f.app.select(sirius.id);f.settle();assert.ok(f.labels().some(b=>b.textContent==='天狼星'));assert.equal(f.app.snapshot.bodies.length,10);assert.equal(f.el('space-body-list').children.length,10);assert.equal(f.d.querySelectorAll('.space-label:not(.space-star-label)').length,10);assert.match(f.el('space-object-kind').textContent,/目录恒星/);assert.match(f.el('space-object-note').textContent,/不生成虚构行星系统/);assert.equal(f.el('space-labels').hasAttribute('aria-hidden'),false);assertDOMFrame(f);}finally{await f.close();}
});

test('click real catalog-label ID opens existing info, never flies or picks canvas; name toggle leaves marker active',async()=>{
 const f=await fixture();try{
  f.pause();f.instance.navigation.setMode('free');f.instance.navigation.setCamera(cameraTo(sirius,[30,30,30],35));f.tick(160);
  const button=f.labels().find(b=>b.dataset.target===sirius.id)!;assert.ok(button);assert.match(button.title,/目录恒星/);assert.match(button.getAttribute('aria-label')!,/恒星.*选择/);
  const before=JSON.stringify(f.app.camera.positionAU);f.pointer('pointerdown',901,600,400,button);f.pointer('pointerup',901,600,400,button);button.click();f.tick();
  assert.equal(f.app.selected,sirius.id);assert.equal(f.instance.navigation.isFlying,false);assert.equal(JSON.stringify(f.app.camera.positionAU),before);assert.equal((f.w as any).__picks,undefined);assert.equal(f.el('space-object').hidden,false);
  assert.equal(f.el('space-crosshair').hidden,false);assert.equal(f.el('space-crosshair').querySelectorAll('[data-focus-edge]').length,4);assert.equal(f.el('space-crosshair').style.width,'48px');
  f.el('space-label-toggle').click();f.tick();assert.equal(f.labels().length,0);assert.ok([...f.d.querySelectorAll('.space-label')].every((b:any)=>b.hidden));assert.equal(f.el('space-crosshair').hidden,false);
  f.el('space-label-toggle').click();f.tick();assert.ok(f.labels().some(b=>b.dataset.target===sirius.id));
  f.el('space-earth').click();f.tick();assert.equal(f.el('space-labels').querySelector('[data-target="earth"]').hidden,false);assert.equal(f.el('space-orbit'),null);assert.equal(f.el('observer-mode-link'),null);assert.equal(f.el('space-cinematic'),null);assert.equal(f.app.options.cinematic,true);
 }finally{await f.close();}
});

for(const hz of [60,120])test(`all displayed catalog labels follow SAME RAF during ${hz}Hz rolled free/orbit dragging, dolly, travel, time and resize/DPR`,async()=>{
 const f=await fixture();try{
  f.pause();f.instance.navigation.setMode('free');f.instance.navigation.setCamera(cameraTo(sirius,[30,30,30],47));f.tick(160);let checked=0,moving=0,prior='';
  f.pointer('pointerdown',902,600,400);
  for(let i=1;i<=40;i++){f.pointer('pointermove',902,600+i*1.2,400+i*.3);f.tick(1000/hz);assertDOMFrame(f);checked+=f.labels().length;const now=f.labels()[0]?.style.transform;if(prior&&now!==prior)moving++;prior=now??'';}
  f.pointer('pointerup',902,648,412);assert.ok(checked>80);assert.ok(moving>20,'geometry moved between refreshes, not just label existence');
  f.app.select(dim.id); // genuine faint identifier, selected priority during flight
  for(let i=0;i<40;i++){f.tick(100);assertDOMFrame(f);}assert.ok(f.labels().some(b=>b.dataset.target===dim.id));
  f.pointer('pointerdown',903,600,400);for(let i=1;i<=30;i++){f.pointer('pointermove',903,600+i*7,400+i*15);f.tick(1000/hz);assertDOMFrame(f);assert.ok(f.labels().some(b=>b.dataset.target===dim.id));}f.pointer('pointerup',903,810,850);
  for(const [width,height,dpr] of [[390,844,2],[844,390,1],[1200,800,2]]){f.resize(width,height,dpr);f.el('space-nearer').click();f.tick(1000/hz);assertDOMFrame(f);f.el('space-farther').click();f.tick(1000/hz);assertDOMFrame(f);assert.ok(f.labels().some(b=>b.dataset.target===dim.id));}
  f.el('space-forward').click();for(let i=0;i<20;i++){f.tick(1000/hz);assertDOMFrame(f);}f.pause();
  f.instance.navigation.setMode('free');const old=f.app.camera;f.instance.navigation.setCamera({...old,azimuthDeg:old.azimuthDeg+180,altitudeDeg:-old.altitudeDeg});f.tick(1000/hz);assert.ok(!f.labels().some(b=>b.dataset.target===dim.id));assert.equal(f.el('space-crosshair').hidden,true);
  f.app.dispose();assert.equal(f.d.querySelectorAll('.space-label').length,0,'dispose removes nodes and closures');
 }finally{await f.close();}
});
