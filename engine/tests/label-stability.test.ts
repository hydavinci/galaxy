// Label-local deterministic repro/acceptance. DOM mutations are not browser
// paint/FPS evidence. Existing independent projection tolerances remain intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {StellarLabelPlanner, StarLabels, overlaps, type LabelFrame, type StarLabelPlacement} from '../src/space/labels';
import {projectSpace} from '../src/space/render-math';
import {PARSEC_AU, AU_KM, type CatalogStar3D, type SpaceCamera, type Vec3} from '../src/space/types';
const stars:CatalogStar3D[]=JSON.parse(await readFile(new URL('../public/data/space-stars.json',import.meta.url),'utf8')).stars;
const camera:SpaceCamera={positionAU:[0,0,0],azimuthDeg:0,altitudeDeg:0,rollDeg:0,fovDeg:60};
const base:LabelFrame={camera,snapshot:{date:new Date('2026-10-15T07:00:00Z'),bodies:[]},width:1200,height:800,now:0,selectedId:null,enabled:true,bodyLabels:[],obstacles:[]};
const single:CatalogStar3D={...stars[0],id:'single',name:'Single',nameZh:undefined,positionAU:[0,0,-1],absoluteMagnitude:-30};
const dense=Array.from({length:9078},(_,i)=>{const positionAU:Vec3=[((i%18)-8.5)*.09,(Math.floor(i/18)%14-6.5)*.075,-1];return {...stars[0],id:`fixture-${i}`,name:`HIP ${i}`,nameZh:undefined,positionAU,absoluteMagnitude:2-5*Math.log10(Math.hypot(...positionAU)/PARSEC_AU/10)};});
function side(p:StarLabelPlacement){const dx=p.x-p.anchor.x,dy=p.y-p.anchor.y;return `${dx>0?'R':dx< -p.width/2-1?'L':'C'}${Math.abs(dy+11)<1e-5?'M':dy<0?'T':'B'}`;}
function validate(labels:StarLabelPlacement[],f:LabelFrame,data:CatalogStar3D[]){
 assert.ok(labels.length<=(f.width<=700?24:48));assert.equal(new Set(labels.map(p=>p.id)).size,labels.length);
 for(const [i,p] of labels.entries()){
  const expected=projectSpace(data.find(s=>s.id===p.id)!.positionAU,f.camera,f.width,f.height);
  assert.ok(expected.visible);assert.ok(Math.hypot(p.anchor.x-expected.x,p.anchor.y-expected.y)<1e-6);
  assert.ok(p.x>=4&&p.y>=4&&p.x+p.width<=f.width-4&&p.y+p.height<=f.height-4);
  for(const o of [...labels.slice(0,i),...f.obstacles,...f.bodyLabels])assert.equal(overlaps(p,o),false);
 }
}
test('valid left slot stays attached through right-slot boundary wobble, not 119 visible hops',()=>{
 const planner=new StellarLabelPlanner([single]);let prior='',flips=0,moving=0,priorAnchor=NaN;
 for(let i=0;i<120;i++){
  const f={...base,now:i*1000/120,camera:{...camera,azimuthDeg:i%2?-.1:.1},obstacles:[{x:668,y:360,width:80,height:80}]};
  const labels=planner.plan(f);assert.equal(labels.length,1);validate(labels,f,[single]);
  const p=labels[0],slot=side(p);if(prior&&slot!==prior)flips++;if(i&&p.anchor.x!==priorAnchor)moving++;prior=slot;priorAnchor=p.anchor.x;
 }
 assert.equal(flips,1,'only the first genuinely blocked right slot causes a change');assert.equal(moving,119,'anchor never frozen');
});
test('dense and real-catalog dragged views retain 48 names with lower measured slot/id churn',()=>{
 for(const [data,real] of [[dense,false],[stars,true]] as const){
  const planner=new StellarLabelPlanner(data);let prior=new Map<string,string>(),flips=0,churn=0;
  for(let i=0;i<360;i++){
   const f={...base,now:i*1000/120,camera:{...camera,azimuthDeg:(real?100:0)+Math.sin(i*.025)*(real?9:7),altitudeDeg:real?-20:0,rollDeg:(real?25:0)+Math.sin(i*.013)*8}};
   const labels=planner.plan(f);assert.equal(labels.length,48);validate(labels,f,data);
   const next=new Map(labels.map(p=>[p.id,side(p)]));
   if(i){for(const [id,slot] of next){if(prior.has(id)&&prior.get(id)!==slot)flips++;if(!prior.has(id))churn++;}for(const id of prior.keys())if(!next.has(id))churn++;}prior=next;
  }
  // Baseline actual source: dense 22/64, real 112/242. No loose geometric
  // tolerance or hidden-all shortcut: every frame above must contain 48 names.
  assert.ok(flips<(real?112:22),`${real?'real':'dense'} flips ${flips}`);assert.ok(churn<(real?242:64),`id churn ${churn}`);
  assert.equal(planner.stats.rebuilds,20);assert.equal(planner.stats.scanned,20*9078);assert.ok(planner.stats.candidates<=144);
 }
});
test('stationary membership is not rescanned by the timer, but moving camera/ranking and selected bypass remain bounded',()=>{
 const planner=new StellarLabelPlanner(dense);for(let i=0;i<120;i++)planner.plan({...base,now:i*1000/120});
 assert.equal(planner.stats.rebuilds,1);assert.equal(planner.stats.scanned,9078);
 planner.plan({...base,now:1000,camera:{...camera,azimuthDeg:5}});assert.equal(planner.stats.rebuilds,2);
 for(let i=1;i<=17;i++)planner.plan({...base,now:1000+i*8.333,camera:{...camera,azimuthDeg:5+i*.1}});
 assert.equal(planner.stats.rebuilds,2);planner.plan({...base,now:1151,camera:{...camera,azimuthDeg:7}});assert.equal(planner.stats.rebuilds,3);
 const id=dense.find(s=>Math.abs(s.positionAU[0])<.05&&Math.abs(s.positionAU[1])<.04)!.id;
 const selected=planner.plan({...base,now:1152,selectedId:id});assert.equal(selected[0].id,id);assert.equal(selected[0].selected,true);assert.equal(planner.stats.rebuilds,4);
 planner.invalidate();planner.plan({...base,now:1153,selectedId:id});assert.equal(planner.stats.rebuilds,5);
});
test('rank hysteresis is bounded: 0.2 mag challenger waits but 0.5 mag brighter challenger wins on refresh',()=>{
 const a={...single,id:'incumbent',name:'X'.repeat(100)},b={...a,id:'challenger',absoluteMagnitude:a.absoluteMagnitude+.1};
 const planner=new StellarLabelPlanner([a,b]),f={...base,obstacles:[{x:0,y:0,width:1200,height:397}]};
 assert.deepEqual(planner.plan(f).map(p=>p.id),[a.id]);
 // Catalog inputs are otherwise immutable; explicit invalidate is the supported
 // refresh when a caller deliberately replaces fixture metadata.
 b.absoluteMagnitude=a.absoluteMagnitude-.2;planner.invalidate();assert.deepEqual(planner.plan({...f,now:151}).map(p=>p.id),[a.id]);
 b.absoluteMagnitude=a.absoluteMagnitude-.5;planner.invalidate();assert.deepEqual(planner.plan({...f,now:302}).map(p=>p.id),[b.id]);
});
test('stationary camera reconsideration admits a brighter newly unocculted reserve without rescanning the catalog',()=>{
 const a={...single,id:'bright',name:'X'.repeat(100),positionAU:[0,0,-10] as Vec3},b={...a,id:'dim',positionAU:[.1,0,-10] as Vec3,absoluteMagnitude:a.absoluteMagnitude+2};
 const planet={id:'earth',name:'地球',nameEn:'Earth',kind:'planet' as const,positionAU:[0,0,-.5] as Vec3,radiusKm:.001*AU_KM,color:'#fff',textureId:'earth',axisNorth:[0,1,0] as Vec3,axisPrime:[1,0,0] as Vec3,axisEast:[0,0,1] as Vec3};
 const planner=new StellarLabelPlanner([a,b]),f={...base,obstacles:[{x:0,y:0,width:1200,height:397}]};
 assert.deepEqual(planner.plan({...f,snapshot:{...base.snapshot,bodies:[planet]}}).map(p=>p.id),[b.id]);
 planner.plan({...f,now:8});assert.deepEqual(planner.plan({...f,now:151}).map(p=>p.id),[a.id]);
 assert.equal(planner.stats.rebuilds,1);assert.equal(planner.stats.scanned,2);assert.equal(planner.stats.reranked,2);
});
test('cached side and rank never preserve offscreen, disabled, occulted or newly faint labels',()=>{
 const planner=new StellarLabelPlanner([single]);assert.equal(planner.plan(base).length,1);
 assert.equal(planner.plan({...base,now:8,camera:{...camera,azimuthDeg:180}}).length,0);
 assert.equal(planner.plan({...base,now:16}).length,1);
 const planet={id:'earth',name:'地球',nameEn:'Earth',kind:'planet' as const,positionAU:[0,0,-.5] as Vec3,radiusKm:.1*AU_KM,color:'#fff',textureId:'earth',axisNorth:[0,1,0] as Vec3,axisPrime:[1,0,0] as Vec3,axisEast:[0,0,1] as Vec3};
 assert.equal(planner.plan({...base,now:24,snapshot:{...base.snapshot,bodies:[planet]}}).length,0);
 assert.equal(planner.plan({...base,now:32}).length,1);assert.equal(planner.plan({...base,now:40,enabled:false}).length,0);
 assert.equal(planner.plan({...base,now:48}).length,1);
 const distant={...base,now:56,camera:{...camera,positionAU:[0,0,1e16] as Vec3}};assert.equal(planner.plan(distant).length,0,'same-frame apparent-magnitude cutoff');
 assert.equal(planner.plan({...distant,selectedId:single.id}).length,1,'selected faint name still bypasses cutoff');
});
test('stationary pool makes zero mutations/hidden setters; motion changes transforms without replacing nodes or handlers',async()=>{
 const w=new Window(),d=w.document;d.body.innerHTML='<div id="labels"></div>';let chosen='';
 const ui=new StarLabels(d.getElementById('labels')! as any,dense,id=>chosen=id);ui.update(base);
 const buttons=[...d.querySelectorAll('button')],bindings=buttons.map(b=>({b,id:b.dataset.target,click:b.onclick,pointer:b.onpointerdown}));assert.equal(buttons.length,48);
 let hiddenSets=0;for(const b of buttons){let p:any=b,desc:PropertyDescriptor|undefined;while(p&&!desc){desc=Object.getOwnPropertyDescriptor(p,'hidden');p=Object.getPrototypeOf(p);}const {get,set}=desc!;Object.defineProperty(b,'hidden',{configurable:true,get(){return get!.call(this)},set(v){hiddenSets++;set!.call(this,v)}});}
 const observer=new w.MutationObserver(()=>{});observer.observe(d.getElementById('labels')!,{subtree:true,attributes:true,childList:true,characterData:true});
 for(let i=1;i<=120;i++)ui.update({...base,now:i*1000/120});assert.equal(observer.takeRecords().length,0);assert.equal(hiddenSets,0);
 for(const binding of bindings){assert.equal(binding.b.dataset.target,binding.id);assert.equal(binding.b.onclick,binding.click);assert.equal(binding.b.onpointerdown,binding.pointer);}
 const prior=new Map(buttons.map(b=>[b.dataset.target,b.style.transform]));ui.update({...base,now:1008,camera:{...camera,azimuthDeg:.1,rollDeg:.2}});
 assert.ok(buttons.filter(b=>!b.hidden&&prior.get(b.dataset.target)!==b.style.transform).length>40);assert.equal(d.querySelectorAll('button').length,48);
 const held=buttons.find(b=>!b.hidden)!;held.focus();const heldId=held.dataset.target;ui.update({...base,now:1016,selectedId:heldId!});assert.equal(d.activeElement,held);assert.equal(held.dataset.target,heldId);held.click();assert.equal(chosen,heldId);
 const ids=new Set(buttons.map(b=>b.dataset.target)),newSelected=dense.find(s=>!ids.has(s.id)&&Math.abs(s.positionAU[0])<.05&&Math.abs(s.positionAU[1])<.04)!;assert.ok(newSelected);
 ui.update({...base,now:1020,selectedId:newSelected.id});assert.equal(held.dataset.target,heldId,'focused node is never rebound to the newcomer');assert.equal(d.activeElement,held);
 const newButton=buttons.find(b=>!b.hidden&&b.dataset.target===newSelected.id)!;assert.ok(newButton,'selected newcomer wins even at the full node cap');newButton.click();assert.equal(chosen,newSelected.id,'reused handler reads current binding');assert.equal(d.querySelectorAll('button').length,48);
 ui.update({...base,now:1024,enabled:false});assert.ok(buttons.every(b=>b.hidden));assert.equal(held.dataset.target,heldId);observer.takeRecords();ui.update({...base,now:1032,enabled:false});assert.equal(observer.takeRecords().length,0);
 ui.dispose();assert.equal(d.querySelectorAll('button').length,0);assert.ok(buttons.every(b=>b.onclick===null&&b.onpointerdown===null));ui.dispose();observer.disconnect();await w.happyDOM.abort();
});
test('obstacle cache notices viewport/hidden changes immediately and retains 150ms measurement fallback',async()=>{
 const w=new Window(),d=w.document;d.body.innerHTML='<div class="journey-heading" hidden></div><div id="labels"></div>';const panel=d.querySelector('.journey-heading')! as any;let reads=0;
 panel.getBoundingClientRect=()=>{reads++;return {left:0,top:0,width:1200,height:70} as DOMRect};
 const ui=new StarLabels(d.getElementById('labels')! as any,[single],()=>{});
 assert.equal(ui.readObstacles(0,1200,800).length,0);panel.hidden=false;assert.equal(ui.readObstacles(8,1200,800).length,1);assert.equal(reads,1);
 ui.readObstacles(16,390,844);assert.equal(reads,2,'real resize invalidates independently of event handlers');ui.readObstacles(24,390,844);assert.equal(reads,2,'new size key was saved');
 panel.hidden=true;assert.equal(ui.readObstacles(32,390,844).length,0);assert.equal(reads,2);panel.hidden=false;ui.readObstacles(40,390,844);assert.equal(reads,3);
 ui.readObstacles(190,390,844);assert.equal(reads,4);ui.invalidateLayout();ui.readObstacles(191,390,844);assert.equal(reads,5);
 ui.dispose();await w.happyDOM.abort();
});
