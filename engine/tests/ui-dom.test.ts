import {fileURLToPath} from 'node:url';
// DOM integration only: renderer is deliberately mocked. This is NOT browser/GPU/layout acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { projectDirection } from '../src/observer/sky-renderer';

const root=fileURLToPath(new URL('../',import.meta.url));
const mockRenderer=`export { apparentDirection, bodyDiskContains, equatorialDirection, projectDirection, transformDirection } from "${root}src/observer/sky-renderer.ts";
export class SkyRenderer {
 constructor(canvas){this.canvas=canvas} async init(){} render(state,camera,settings){this.state=state;this.camera=camera;this.settings=settings}
 getStats(){return {catalogCount:115517,hipsTiles:12,hipsLoading:0,fps:60,status:'MOCK ONLY'}}
 projectEquatorial(ra,dec,state,camera,refraction){return {x:500+ra*20,y:350-dec*30,visible:true,altitudeDeg:30,azimuthDeg:180}}
 projectHorizontal(az,alt,camera){return {x:50+az*2,y:600,visible:az<270,altitudeDeg:alt,azimuthDeg:az}} dispose(){}
}`;
let bundled:Promise<string>|undefined;
function bundle(){return bundled??=build({absWorkingDir:root,entryPoints:['tests/fixtures/observer-entry.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',loader:{'.css':'empty'},plugins:[{name:'mock-renderer-for-dom-only',setup(b){b.onResolve({filter:/sky-renderer$/},()=>({path:'sky-renderer',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mockRenderer,loader:'js',resolveDir:root}));}}]}).then(r=>r.outputFiles[0].text);}
async function setup(options:{failNames?:boolean;stored?:Record<string,unknown>;currentStored?:Record<string,unknown>;width?:number;height?:number}={}){
 const width=options.width??1440,height=options.height??900;
 const window=new Window({url:'http://localhost:3784/',width,height});
 const doc=window.document;doc.write((await readFile(root+'tests/fixtures/observer.html','utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
 const style=doc.createElement('style');style.textContent=await readFile(root+'src/observer/style.css','utf8');doc.head.appendChild(style);
 const data=await readFile(root+'public/data/named-stars.json','utf8');
 window.fetch=(async()=>{if(options.failNames)throw new Error('Name service offline');return {ok:true,json:async()=>JSON.parse(data)};}) as any;
 const geolocationCalls:string[]=[];
 Object.defineProperty(window.navigator,'geolocation',{value:{getCurrentPosition(){geolocationCalls.push('getCurrentPosition');},watchPosition(){geolocationCalls.push('watchPosition');}}});
 let raf:FrameRequestCallback|undefined;window.requestAnimationFrame=((fn:FrameRequestCallback)=>{raf=fn;return 1;}) as any;window.cancelAnimationFrame=()=>{};
 Object.defineProperty(doc,'hidden',{value:false});
 Object.defineProperty(doc.getElementById('sky'),'clientHeight',{value:height});Object.defineProperty(doc.getElementById('sky'),'clientWidth',{value:width});
 if(options.stored)window.localStorage.setItem('galaxy-observer-preview-v1',JSON.stringify(options.stored));
 if(options.currentStored)window.localStorage.setItem('galaxy-allsky-v2',JSON.stringify(options.currentStored));
 window.eval(await bundle());
 // Flush async bootstrap without waiting on timers or RAF.
 for(let i=0;i<25&&!doc.body.dataset.ready;i++)await new Promise<void>(r=>setImmediate(r));
 assert.equal(doc.body.dataset.ready,'true',doc.getElementById('loading-text')?.textContent||'bootstrap failed');
 let now=window.performance.now();
 const tick=(ms=300)=>{now+=ms;const fn=raf;raf=undefined;assert.ok(fn,'animation is still scheduled');fn(now);assert.equal(doc.body.dataset.ready,'true',doc.getElementById('loading-text')?.textContent||'frame failed');};
 const settle=()=>{for(let i=0;i<25;i++)tick(100);};
 const el=(id:string)=>doc.getElementById(id) as any;
 const change=(id:string,value:any)=>{el(id).value=value;el(id).dispatchEvent(new window.Event('change',{bubbles:true}));};
 const input=(id:string,value:any)=>{el(id).value=value;el(id).dispatchEvent(new window.Event('input',{bubbles:true}));};
 const key=(target:any,key:string,code=key)=>{const event=new window.KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
 return {window,doc,el,tick,settle,change,input,key,geolocationCalls,app:(window as any).__galaxy,close:()=>window.happyDOM.abort()};
}
const plain=(value:any)=>JSON.parse(JSON.stringify(value));
const defaultLocation={name:'苏州',latitude:31.2989,longitude:120.5853,elevation:10,timezone:'Asia/Shanghai'};
const targetNames={sun:'太阳',moon:'月亮',mercury:'水星',venus:'金星',mars:'火星',jupiter:'木星',saturn:'土星',uranus:'天王星',neptune:'海王星'};
const removedSelectors=[
 '.sky-summary','#sky-period','#local-clock','#local-date','#time-open','#view-mode-note',
 '.tonight-card','#tonight-card','#tonight-list','#tonight-note','#location-open','#location-name',
 '#location-dialog','#location-form','#location-preset','#latitude','#longitude','#elevation','#timezone','#custom-name','#location-error',
 '#time-dialog','#time-form','#datetime','#time-zone-label','#time-tonight','#time-current','#time-error',
 '.location-dot','.live-dot','.chevron','.input-pair','.preset-row',
];
const retainedButtons=['settings-open','planets-open','zoom-in','zoom-out','reset-view','rewind','pause','forward','now','about-open','immersive'];
function assertTargetCentered(f:Awaited<ReturnType<typeof setup>>,body:any){
 f.settle();
 assert.equal(f.app.selected.id,body.id);
 assert.ok(Math.abs(f.app.camera.altitudeDeg-body.altitudeDeg)<.02,`${body.id} altitude`);
 const azDifference=((f.app.camera.azimuthDeg-body.azimuthDeg+540)%360)-180;
 assert.ok(Math.abs(azDifference)<.02,`${body.id} azimuth`);
 assert.ok(f.app.camera.fovDeg<4,`${body.id} inspection zoom`);
 assert.equal(f.el('object-panel').hidden,false);
 assert.equal(f.el('object-track').getAttribute('aria-pressed'),'true');
 assert.equal(f.el('selection-marker').hidden,false);
}

test('DOM bootstrap retains catalog and Suzhou science defaults without requesting geolocation',async()=>{
 const f=await setup();try{
  assert.equal(f.el('loading').hidden,true);assert.equal(f.app.catalogStars,355);
  assert.deepEqual(plain(f.app.state.location),defaultLocation);assert.equal(f.app.settings.mode,'visual');
  assert.ok(!f.doc.querySelector('.sky-label')?.textContent?.includes('Sol'));
  f.tick();assert.match(f.el('catalog-status').textContent,/115,517/);
  assert.deepEqual(f.geolocationCalls,[]);
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem('galaxy-allsky-v2')!).location,defaultLocation);
 }finally{await f.close();}
});

for(const [width,height] of [[1440,900],[360,740],[844,390]])test(`minimal DOM has no removed panel or placeholder at ${width}x${height}; selected-object panel still opens`,async()=>{
 const f=await setup({width,height});try{
  for(const selector of removedSelectors)assert.equal(f.doc.querySelector(selector),null,selector);
  assert.equal(f.doc.querySelector('input[type="datetime-local"],time'),null);
  assert.deepEqual(Array.from(f.doc.querySelectorAll('dialog:not(#earth-dialog)'),d=>d.id),['settings-dialog','about-dialog','planets-dialog']);
  assert.equal(f.doc.querySelectorAll('#earth-dialog').length,1);
  assert.equal(f.doc.querySelector('#earth-canvas'),null,'globe is lazy, not part of sky startup');
  assert.deepEqual(Array.from(f.doc.querySelector('.app-chrome')!.children,e=>e.tagName),['HEADER','ASIDE','DIV','FOOTER']);
  assert.equal(f.doc.querySelector('.header-actions')!.children.length,1);
  assert.equal(f.el('search').disabled,false);
  for(const id of retainedButtons){assert.ok(f.el(id),id);assert.equal(f.el(id).disabled,false,id);assert.equal(f.el(id).hidden,false,id);}
  for(const name of ['constellations','grid','labels'])assert.ok(f.doc.querySelector(`[data-toggle="${name}"]`));
  assert.equal(f.el('object-panel').hidden,true);
  f.input('search','月亮');f.el('search-results').querySelector('button').click();f.tick();
  assert.equal(f.el('object-panel').hidden,false);
  assert.notEqual(f.window.getComputedStyle(f.el('object-panel')).display,'none');
  assert.equal(f.window.getComputedStyle(f.el('object-panel')).position,'fixed');
  for(const id of ['object-close','object-center','object-track','object-zoom'])assert.equal(f.el(id).disabled,false);
  f.el('object-close').click();assert.equal(f.el('object-panel').hidden,true);
  assert.deepEqual(f.geolocationCalls,[]);
 }finally{await f.close();}
});

test('removed UI leaves no CSS rules, bindings, date-formatting work or label obstacles',async()=>{
 const css=await readFile(root+'src/observer/style.css','utf8');
 const app=await readFile(root+'src/observer/app.ts','utf8');
 for(const selector of removedSelectors){
  assert.ok(!css.includes(selector),`obsolete CSS ${selector}`);
  assert.ok(!app.includes(selector.slice(1)),`obsolete UI reference ${selector}`);
 }
 assert.doesNotMatch(css,/\.full-width|\.form-error/);
 assert.doesNotMatch(app,/lastList|updateTonight|fillLocation|parseLocalDateTime|formatLocalDateTime|Intl\.DateTimeFormat/);
 assert.match(app,/querySelectorAll<HTMLElement>\('\.topbar,\.object-panel,\.toolbar'\)/);
});

test('bottom time controls still pause, resume, step forward/backward speeds and return to now',async()=>{
 const f=await setup();try{
  f.el('pause').click();f.tick();assert.equal(f.app.speed,0);
  assert.equal(f.el('pause').getAttribute('aria-label'),'继续时间');assert.equal(f.el('speed-label').textContent,'暂停');
  const paused=f.app.state.date.getTime();f.tick(5000);assert.equal(f.app.state.date.getTime(),paused);
  f.el('pause').click();f.tick(1000);assert.equal(f.app.speed,1);assert.equal(f.app.state.date.getTime(),paused+1000);
  assert.equal(f.el('pause').getAttribute('aria-label'),'暂停时间');
  f.el('forward').click();f.tick(1000);assert.equal(f.app.speed,60);assert.equal(f.app.state.date.getTime(),paused+61000);
  assert.equal(f.el('speed-label').textContent,'60×');
  f.el('pause').click();f.tick(1000);const stopped=f.app.state.date.getTime();assert.equal(f.app.speed,0);
  f.el('pause').click();f.tick(1000);assert.equal(f.app.speed,60);assert.equal(f.app.state.date.getTime(),stopped+60000);
  for(const speed of [1,0,-1,-60]){f.el('rewind').click();assert.equal(f.app.speed,speed);}
  const beforeRewind=f.app.state.date.getTime();f.tick(1000);assert.equal(f.app.state.date.getTime(),beforeRewind-60000);
  assert.equal(f.el('speed-label').textContent,'−60×');
  f.el('now').click();f.tick();assert.equal(f.app.speed,1);assert.ok(Math.abs(f.app.state.date.getTime()-Date.now())<3000);
  assert.equal(f.el('speed-label').textContent,'1×');assert.equal(f.el('pause-icon').textContent,'Ⅱ');
  assert.equal(f.doc.querySelector('#local-clock,#local-date,#time-dialog'),null);
 }finally{await f.close();}
});

test('legacy saved location and display preferences remain compatible without location controls',async()=>{
 const stored={location:{name:'悉尼',latitude:-33.86,longitude:151.2,elevation:10,timezone:'Australia/Sydney'},settings:{ground:true,atmosphere:true,refraction:true,labels:false,milkyWay:false,grid:true,constellations:true,mode:'enhanced',lightPollution:7}};
 const f=await setup({stored});try{
  f.app.setDate('2026-10-13T12:50:08Z');f.tick();
  assert.deepEqual(plain(f.app.state.location),stored.location);
  for(const name of ['labels','milkyWay','grid','constellations','mode','lightPollution'] as const)assert.equal(f.app.settings[name],stored.settings[name]);
  for(const name of ['ground','atmosphere','refraction'])assert.equal(f.app.settings[name],false);
  const saved=JSON.parse(f.window.localStorage.getItem('galaxy-allsky-v2')!);
  assert.deepEqual(saved.location,stored.location);assert.deepEqual(saved.settings,plain(f.app.settings));
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem('galaxy-observer-preview-v1')!),stored);
  assert.equal(f.el('location-open'),null);assert.deepEqual(f.geolocationCalls,[]);
 }finally{await f.close();}
});

test('current saved custom UTC location wins over legacy storage and is not reset by settings or time controls',async()=>{
 const currentStored={location:{name:'赤道测试',latitude:0,longitude:0,elevation:0,timezone:'UTC'},settings:{labels:false,milkyWay:false,grid:true,constellations:true,mode:'enhanced',lightPollution:2}};
 const stored={location:defaultLocation,settings:{labels:true,grid:false,mode:'visual'}};
 const f=await setup({stored,currentStored});try{
  assert.deepEqual(plain(f.app.state.location),currentStored.location);
  assert.equal(f.app.settings.mode,'enhanced');assert.equal(f.app.settings.grid,true);assert.equal(f.app.settings.labels,false);
  assert.equal(f.el('sky-mode').value,'enhanced');assert.equal(f.el('pollution').value,'2');assert.equal(f.el('milkyway').checked,false);
  f.el('pause').click();f.el('rewind').click();f.tick();f.el('now').click();f.tick();f.input('pollution','3');
  const saved=JSON.parse(f.window.localStorage.getItem('galaxy-allsky-v2')!);
  assert.deepEqual(saved.location,currentStored.location);assert.deepEqual(plain(f.app.state.location),currentStored.location);
  assert.equal(saved.settings.labels,false);assert.equal(saved.settings.constellations,true);assert.equal(saved.settings.milkyWay,false);assert.equal(saved.settings.lightPollution,3);
  assert.deepEqual(f.geolocationCalls,[]);
 }finally{await f.close();}
});

test('invalid persisted location is rejected safely rather than applied to the sky',async()=>{
 for(const patch of [{latitude:100},{latitude:'0'},{timezone:'Not/AZone'}]){
  const f=await setup({currentStored:{location:{...defaultLocation,...patch}}});try{
   f.tick();assert.deepEqual(plain(f.app.state.location),defaultLocation);
   assert.deepEqual(JSON.parse(f.window.localStorage.getItem('galaxy-allsky-v2')!).location,defaultLocation);
   assert.deepEqual(f.geolocationCalls,[]);
  }finally{await f.close();}
 }
});

test('Chinese body/star and constellation search retains info, tracking, keyboard selection and close',async()=>{
 const f=await setup();try{
  f.key(f.el('sky'),'/');assert.equal(f.doc.activeElement,f.el('search'));
  f.input('search','月亮');assert.equal(f.el('search').getAttribute('aria-expanded'),'true');
  const results=f.el('search-results');assert.match(results.textContent,/月亮/);
  f.key(f.el('search'),'ArrowDown');assert.equal(f.doc.activeElement,results.querySelector('button'));
  results.querySelector('button').click();assert.equal(f.app.selected.id,'moon');assert.equal(f.el('object-panel').hidden,false);
  assert.equal(f.el('object-track').getAttribute('aria-pressed'),'true');assert.match(f.el('object-facts').textContent,/角直径/);assert.match(f.el('object-note').textContent,/真实角尺寸/);
  f.el('object-track').click();assert.equal(f.el('object-track').getAttribute('aria-pressed'),'false');
  f.input('search','织女');f.key(f.el('search'),'Enter');assert.equal(f.el('object-name').textContent,'织女星');assert.match(f.el('object-facts').textContent,/此星表未提供/);
  f.input('search','猎户');results.querySelector('button').click();assert.equal(f.app.selected.kind,'constellation');
  f.el('object-close').click();assert.equal(f.el('object-panel').hidden,true);assert.equal(f.app.selected,null);
  f.input('search','织女');f.key(f.el('search'),'Escape');assert.equal(results.hidden,true);assert.equal(f.el('search').getAttribute('aria-expanded'),'false');
 }finally{await f.close();}
});

test('view zoom/reset, selected-object centering, zoom and tracking remain functional',async()=>{
 const f=await setup();try{
  const initial=f.app.camera.fovDeg;f.el('zoom-in').click();assert.ok(f.app.camera.fovDeg<initial);f.el('zoom-out').click();assert.ok(Math.abs(f.app.camera.fovDeg-initial)<1e-10);
  f.key(f.el('sky'),'ArrowRight');f.settle();assert.notEqual(f.app.camera.azimuthDeg,180);
  f.el('reset-view').click();f.settle();assert.deepEqual(plain(f.app.camera),{azimuthDeg:180,altitudeDeg:35,fovDeg:70});
  f.app.setDate('2026-10-13T12:50:08Z');f.tick();f.input('search','Moon');f.el('search-results').querySelector('button').click();
  const moon=f.app.state.bodies.find((b:any)=>b.id==='moon');assertTargetCentered(f,moon);
  f.key(f.el('sky'),'ArrowRight');f.settle();assert.equal(f.el('object-track').getAttribute('aria-pressed'),'false');
  f.el('object-center').click();f.settle();assert.ok(Math.abs(f.app.camera.altitudeDeg-moon.altitudeDeg)<.02);
  f.el('zoom-out').click();const before=f.app.camera.fovDeg;f.el('object-zoom').click();f.settle();assert.ok(f.app.camera.fovDeg<before);
  assert.equal(f.el('object-track').getAttribute('aria-pressed'),'true','inspection keeps a planet centered at high magnification');
  f.el('object-track').click();assert.equal(f.el('object-track').getAttribute('aria-pressed'),'false');f.el('object-track').click();assert.equal(f.el('object-track').getAttribute('aria-pressed'),'true');
  f.doc.querySelector<any>('.brand')!.click();f.settle();assert.deepEqual(plain(f.app.camera),{azimuthDeg:180,altitudeDeg:35,fovDeg:70});assert.equal(f.el('object-track').getAttribute('aria-pressed'),'false');
  f.el('object-close').click();assert.equal(f.el('selection-marker').hidden,true);
 }finally{await f.close();}
});

test('settings persist, all display switches work, about and immersive controls remain available',async()=>{
 const f=await setup();try{
  f.el('settings-open').click();assert.ok(f.el('settings-dialog').open);
  f.change('sky-mode','enhanced');assert.equal(f.app.settings.mode,'enhanced');f.input('pollution','8');assert.equal(f.app.settings.lightPollution,8);assert.equal(f.el('pollution-value').textContent,'8 / 9');
  f.el('milkyway').checked=false;f.el('milkyway').dispatchEvent(new f.window.Event('change'));assert.equal(f.app.settings.milkyWay,false);
  f.el('settings-dialog').querySelector('[data-close]').click();assert.equal(f.el('settings-dialog').open,false);
  for(const name of ['constellations','grid','labels']){
   const button=f.doc.querySelector<any>(`[data-toggle="${name}"]`)!;const before=f.app.settings[name];button.click();assert.equal(f.app.settings[name],!before);assert.equal(button.getAttribute('aria-pressed'),String(!before));
  }
  assert.equal(f.doc.querySelector('[data-toggle="ground"]'),null);
  for(const name of ['ground','atmosphere','refraction'])assert.equal(f.app.settings[name],false);
  f.change('sky-mode','visual');assert.equal(f.app.settings.mode,'visual');
  const saved=JSON.parse(f.window.localStorage.getItem('galaxy-allsky-v2')!);assert.deepEqual(saved.settings,plain(f.app.settings));assert.deepEqual(saved.location,defaultLocation);
  f.el('immersive').click();assert.ok(f.doc.body.classList.contains('immersive'));assert.equal(f.el('exit-immersive').hidden,false);
  f.el('exit-immersive').click();assert.ok(!f.doc.body.classList.contains('immersive'));assert.equal(f.el('exit-immersive').hidden,true);
  f.el('immersive').click();f.key(f.el('sky'),'Escape');assert.ok(!f.doc.body.classList.contains('immersive'));
  f.el('about-open').click();assert.ok(f.el('about-dialog').open);assert.match(f.el('about-dialog').textContent,/非 Stellarium 官方产品/);f.el('about-dialog').querySelector('[data-close]').click();assert.equal(f.el('about-dialog').open,false);
 }finally{await f.close();}
});

test('no-match query remains safe text and never injects markup',async()=>{
 const f=await setup();try{f.input('search','<img src=x onerror=alert(1)>');assert.equal(f.el('search-results').querySelectorAll('img').length,0);assert.match(f.el('search-results').textContent,/没有匹配/);}finally{await f.close();}
});

test('failed names do not block sky or planet search',async()=>{
 const f=await setup({failNames:true});try{assert.equal(f.app.catalogStars,0);f.tick();assert.equal(f.doc.body.dataset.ready,'true');assert.match(f.el('catalog-status').textContent,/星名不可用/);f.input('search','月亮');assert.match(f.el('search-results').textContent,/月亮/);}finally{await f.close();}
});

test('Space shortcut preserves focused-button semantics and pauses only the canvas, not modal dialogs',async()=>{
 const f=await setup();try{
  const button=f.el('settings-open');button.focus();assert.equal(f.key(button,' ','Space').defaultPrevented,false);assert.equal(f.app.speed,1);
  f.el('sky').focus();assert.equal(f.key(f.el('sky'),' ','Space').defaultPrevented,true);assert.equal(f.app.speed,0);
  f.el('settings-open').click();f.key(f.el('settings-dialog'),' ','Space');assert.equal(f.app.speed,0);
 }finally{await f.close();}
});

test('screenshot regression: below-ground Moon can be located, magnified and tracked without horizon warnings',async()=>{
 const f=await setup();try{
  f.app.setDate('2026-10-13T12:50:08Z');f.tick();const moon=f.app.state.bodies.find((b:any)=>b.id==='moon');assert.ok(moon.altitudeDeg<-20);
  f.input('search','Moon');f.el('search-results').querySelector('button').click();assertTargetCentered(f,moon);
  assert.match(f.el('object-visibility').textContent,/全空可查看/);assert.doesNotMatch(f.el('object-visibility').textContent,/地平|下方/);assert.doesNotMatch(f.el('object-facts').textContent,/高度角|方位角/);assert.equal(f.el('toast').hidden,true);
 }finally{await f.close();}
});

test('all nine solar-system targets remain searchable and usable in the menu by day/night, including negative altitudes',async()=>{
 const f=await setup();try{
  for(const date of ['2026-10-13T04:00:00Z','2026-10-13T12:50:08Z']){
   f.app.setDate(date);f.tick(11000);
   assert.ok(f.app.state.bodies.some((b:any)=>b.altitudeDeg<0));
   assert.deepEqual(Array.from(f.app.state.bodies,(b:any)=>b.id).sort(),Object.keys(targetNames).sort());
   for(const [id,name] of Object.entries(targetNames)){
    const body=f.app.state.bodies.find((b:any)=>b.id===id);
    f.input('search',name);const searchEntry=f.el('search-results').querySelector('button');assert.ok(searchEntry,`search ${id}`);searchEntry.click();assertTargetCentered(f,body);
    f.el('planets-open').click();assert.ok(f.el('planets-dialog').open);
    const list=f.el('planets-list');assert.equal(list.querySelectorAll('button[data-body]').length,9);
    assert.equal(list.querySelectorAll('button[data-inspector="earth"]').length,1);
    assert.equal(list.querySelectorAll('button').length,10);
    assert.deepEqual(Array.from(list.querySelectorAll('button[data-body]'),(b:any)=>b.dataset.body).sort(),Object.keys(targetNames).sort());
    const entry=list.querySelector(`button[data-body="${id}"]`);assert.ok(entry,`menu ${id}`);assert.equal(entry.disabled,false);entry.click();
    assert.equal(f.el('planets-dialog').open,false);assertTargetCentered(f,body);assert.match(f.el('object-visibility').textContent,/全空/);
   }
   assert.equal(f.app.settings.ground,false);assert.equal(f.app.settings.atmosphere,false);
  }
 }finally{await f.close();}
});

test('planet menu is populated only on open; running clock and UI invalidation never detach its focused target',async()=>{
 const f=await setup();try{
  const list=f.el('planets-list');assert.equal(list.children.length,0);f.tick(11000);assert.equal(list.children.length,0,'no hidden periodic menu work');
  f.el('planets-open').click();const entries=Array.from(list.querySelectorAll('button'));
  const focused=list.querySelector('button[data-body="neptune"]');focused.focus();assert.equal(f.doc.activeElement,focused);
  for(let i=0;i<3;i++){
   f.tick(11000);assert.equal(f.doc.activeElement,focused);assert.equal(focused.isConnected,true);assert.deepEqual(Array.from(list.querySelectorAll('button')),entries);
  }
  f.el('pause').click();f.tick(11000);assert.equal(f.doc.activeElement,focused);assert.deepEqual(Array.from(list.querySelectorAll('button')),entries);
  focused.click();assert.equal(f.app.selected.id,'neptune');assert.equal(f.el('planets-dialog').open,false);
  f.input('pollution','6');f.tick(11000);assert.deepEqual(Array.from(list.querySelectorAll('button')),entries,'closed menu is not periodically rewritten either');
  f.el('planets-open').click();assert.equal(list.querySelectorAll('button[data-body]').length,9);assert.equal(list.querySelectorAll('button[data-inspector="earth"]').length,1);f.el('planets-dialog').querySelector('[data-close]').click();assert.equal(f.el('planets-dialog').open,false);
 }finally{await f.close();}
});

function gestureHarness(f:Awaited<ReturnType<typeof setup>>){
 const canvas=f.el('sky'),captured=new Set<number>();canvas.setPointerCapture=(id:number)=>captured.add(id);canvas.hasPointerCapture=(id:number)=>captured.has(id);canvas.releasePointerCapture=(id:number)=>captured.delete(id);
 const pointer=(type:string,id:number,x:number,y=422)=>canvas.dispatchEvent(new f.window.PointerEvent(type,{pointerId:id,button:0,clientX:x,clientY:y,bubbles:true}));
 const tracked=()=>f.el('object-track').getAttribute('aria-pressed');
 const centered=()=>{const b=f.app.state.bodies.find((b:any)=>b.id==='neptune'),c=f.app.camera;
  const az=((c.azimuthDeg-b.azimuthDeg+540)%360)-180;assert.ok(Math.abs(az)<c.fovDeg*.00001,`tracking azimuth drift: ${az} vs FOV ${c.fovDeg}`);assert.ok(Math.abs(c.altitudeDeg-b.altitudeDeg)<c.fovDeg*.00001,'tracking altitude drift');assert.equal(tracked(),'true');};
 const prepare=()=>{f.app.setDate('2026-10-13T15:52:00Z');f.tick();f.app.select('neptune');for(let i=0;i<80;i++)f.tick(100);f.el('forward').click();assert.equal(f.app.speed,1);f.tick(100);};
 return {pointer,tracked,centered,prepare};
}
test('QA-1: advancing 1x Neptune stays tracked while holding a 3x portrait pinch',async()=>{
 const f=await setup({width:390,height:844});try{const g=gestureHarness(f);g.prepare();g.pointer('pointerdown',11,175);g.pointer('pointerdown',12,215);g.pointer('pointermove',12,295);
  for(let i=0;i<10;i++){f.tick(100);g.centered();}
 }finally{await f.close();}
});
test('QA-1: a stationary one-finger touch and sub-threshold jitter keep following',async()=>{
 const f=await setup({width:390,height:844});try{const g=gestureHarness(f);g.prepare();g.pointer('pointerdown',11,175);
  for(let i=0;i<5;i++){f.tick(100);g.centered();}g.pointer('pointermove',11,176);f.tick(100);g.centered();
 }finally{await f.close();}
});
for(const end of ['pointerup','pointercancel','lostpointercapture'])test(`QA-2: pinch 2→1 ${end} resets single-pan threshold; 1px jitter preserves tracking`,async()=>{
 const f=await setup({width:390,height:844});try{const g=gestureHarness(f);g.prepare();g.pointer('pointerdown',11,175);g.pointer('pointerdown',12,215);g.pointer('pointermove',12,295);g.pointer(end,12,295);
  g.pointer('pointermove',11,176);assert.equal(g.tracked(),'true');f.tick(100);g.centered();
  g.pointer('pointermove',11,182);assert.equal(g.tracked(),'false','intentional new single-finger pan releases tracking');g.pointer('pointerup',11,182);
 }finally{await f.close();}
});
test('QA-2: pinch cancellation never clicks a target or leaks stale pan distance into a new contact',async()=>{
 const f=await setup({width:390,height:844});try{const g=gestureHarness(f);g.prepare();g.pointer('pointerdown',11,175);g.pointer('pointerdown',12,215);g.pointer('pointercancel',12,215);g.pointer('lostpointercapture',11,175);
  g.pointer('pointerdown',13,175);g.pointer('pointermove',13,176);f.tick(100);g.centered();assert.equal(f.app.selected.id,'neptune');
 }finally{await f.close();}
});

test('QA-2: three contacts and repeated contact changes re-anchor pinch without jumps or stale pan',async()=>{
 const f=await setup({width:390,height:844});try{const g=gestureHarness(f);g.prepare();g.pointer('pointerdown',11,175);g.pointer('pointerdown',12,215);g.pointer('pointermove',12,295);const before=f.app.camera.fovDeg;
  g.pointer('pointerdown',13,315);g.pointer('pointermove',13,316);g.pointer('pointerup',12,295);g.pointer('pointermove',13,317);
  assert.ok(Math.abs(f.app.camera.fovDeg/before-141/142)<1e-10,'3→2 pinch re-anchors at remaining pair');f.tick(100);g.centered();
  g.pointer('lostpointercapture',13,317);g.pointer('pointermove',11,176);f.tick(100);g.centered();g.pointer('pointerup',11,176);
 }finally{await f.close();}
});
for(const end of ['pointercancel','lostpointercapture'])test(`QA-2: ${end} during a deliberate pan clears inertia`,async()=>{
 const f=await setup({width:390,height:844});try{const g=gestureHarness(f);g.prepare();g.pointer('pointerdown',11,175);g.pointer('pointermove',11,215);assert.equal(g.tracked(),'false');g.pointer(end,11,215);
  const camera=plain(f.app.camera);for(let i=0;i<20;i++)f.tick(100);assert.deepEqual(plain(f.app.camera),camera,'no latent inertia after interrupted input');
 }finally{await f.close();}
});


// Keep scientific time advancing: the former paused-only centering assertion
// missed a frozen destination which has already left an arcsecond-size view.
for(const [width,height] of [[1200,550],[390,844],[844,390]])for(const scale of ['inspection','minimum'])for(const speed of [0,1])test(`CENTER: nine bodies stay centered after pan at ${width}x${height}, ${scale}, ${speed}x`,async()=>{
 const f=await setup({width,height});try{
  const g=gestureHarness(f);
  for(const id of Object.keys(targetNames)){
   f.app.setDate('2026-10-14T00:24:00Z');f.tick();f.app.select(id);for(let i=0;i<60;i++)f.tick(100);
   if(scale==='minimum')for(let i=0;i<50;i++)f.el('zoom-in').click();
   if(speed)f.el('forward').click();assert.equal(f.app.speed,speed);
   g.pointer('pointerdown',201,width/2,height/2);g.pointer('pointermove',201,width/2+40,height/2);g.pointer('pointerup',201,width/2+40,height/2);
   assert.equal(g.tracked(),'false','intentional pan releases tracking');
   const fov=f.app.camera.fovDeg,start=f.app.state.date.getTime();
   f.el('object-center').click();for(let i=0;i<60;i++)f.tick(100);
   const body=f.app.state.bodies.find((b:any)=>b.id===id),point=projectDirection(body.direction,f.app.camera,width,height);
   const offset=Math.hypot(point.x-width/2,point.y-height/2);
   assert.ok(point.visible&&offset<.01,`${id}: center moved away by ${offset} CSS pixels`);
   assert.equal(f.app.camera.fovDeg,fov,'centering must not change optical scale');
   assert.equal(f.app.speed,speed,'centering must not change time speed');
   assert.equal(g.tracked(),'true','center explicitly enables the visible tracking toggle');
   // Ephemeris updates are intentionally throttled to 250ms at 1x; do not
   // confuse its last sampled timestamp with the clock/RAF timestamp.
   const elapsed=f.app.state.date.getTime()-start;
   if(speed)assert.ok(elapsed>=5750&&elapsed<=6000,`scientific time advanced: ${elapsed}ms`);
   else assert.equal(elapsed,0);
   for(let i=0;i<15;i++){f.tick(100);const current=f.app.state.bodies.find((b:any)=>b.id===id),p=projectDirection(current.direction,f.app.camera,width,height);assert.ok(p.visible&&Math.hypot(p.x-width/2,p.y-height/2)<.01,'hold center after slew');}
  }
 }finally{await f.close();}
});

test('CENTER: wide-field Mercury recenter, repeated click, manual tracking off and pan remain distinct',async()=>{
 const f=await setup({width:1200,height:550});try{
  const g=gestureHarness(f);f.app.setDate('2026-10-14T00:24:00Z');f.tick();f.app.select('mercury');for(let i=0;i<60;i++)f.tick(100);
  for(let i=0;i<50;i++)f.el('zoom-out').click();assert.equal(f.app.camera.fovDeg,110);f.el('forward').click();
  g.pointer('pointerdown',202,600,275);g.pointer('pointermove',202,900,275);g.pointer('pointerup',202,900,275);
  f.el('object-center').click();for(let i=0;i<30;i++)f.tick(100);f.el('object-center').click();for(let i=0;i<40;i++)f.tick(100);
  assert.equal(g.tracked(),'true');assert.equal(f.app.camera.fovDeg,110);const b=f.app.state.bodies.find((b:any)=>b.id==='mercury'),p=projectDirection(b.direction,f.app.camera,1200,550);assert.ok(Math.hypot(p.x-600,p.y-275)<.01);
  f.el('object-track').click();assert.equal(g.tracked(),'false','explicit untrack still works');f.el('object-center').click();assert.equal(g.tracked(),'true');
  g.pointer('pointerdown',203,600,275);g.pointer('pointermove',203,650,275);g.pointer('pointerup',203,650,275);assert.equal(g.tracked(),'false','deliberate pan still releases tracking');
  f.el('object-center').click();f.el('object-close').click();assert.equal(f.app.selected,null);assert.equal(g.tracked(),'false');assert.equal(f.el('object-panel').hidden,true);
 }finally{await f.close();}
});

for(const query of ['织女','猎户'])test(`CENTER: ${query} retains field and follows the selected non-planet target`,async()=>{
 const f=await setup();try{
  f.app.setDate('2026-10-14T00:24:00Z');f.tick();f.input('search',query);f.el('search-results').querySelector('button').click();f.settle();f.el('forward').click();
  f.key(f.el('sky'),'ArrowRight');f.settle();assert.equal(f.el('object-track').getAttribute('aria-pressed'),'false');const fov=f.app.camera.fovDeg;
  f.el('object-center').click();f.settle();assert.equal(f.el('object-track').getAttribute('aria-pressed'),'true');assert.equal(f.app.camera.fovDeg,fov);assert.equal(f.app.speed,1);
 }finally{await f.close();}
});


for(const [width,height] of [[1440,900],[390,844],[844,390]])test(`DETAIL: Saturn menu/search/inspection fit all main rings and keep centered globe at ${width}x${height}`,async()=>{
 const f=await setup({width,height});try{
  f.app.setDate('2026-10-14T01:10:00Z');f.tick();
  for(const route of ['menu','search','inspect']){
   if(route==='menu'){f.el('planets-open').click();f.el('planets-list').querySelector('[data-body=saturn]').click();}
   else if(route==='search'){f.el('reset-view').click();f.settle();f.input('search','土星');f.el('search-results').querySelector('button').click();}
   else{f.el('zoom-in').click();f.el('object-zoom').click();}
   for(let i=0;i<70;i++)f.tick(100);
   const b=f.app.state.bodies.find((b:any)=>b.id==='saturn'),c=f.app.camera;
   const ringRadius=Math.sin(b.angularDiameterRad/2)*(136770/60268);
   const outerDiameter=height*ringRadius/Math.sqrt(1-ringRadius*ringRadius)/Math.tan(c.fovDeg*Math.PI/360);
   assert.ok(Math.abs(outerDiameter/Math.min(width,height)-.7)<1e-7,'full main-ring optical envelope fits');
   assert.equal(f.el('object-track').getAttribute('aria-pressed'),'true');assert.equal(f.app.selected.id,'saturn');
   const fov=c.fovDeg;f.el('object-center').click();for(let i=0;i<30;i++)f.tick(100);assert.equal(f.app.camera.fovDeg,fov);
  }
  assert.match(f.el('object-note').textContent,/主环/);
 }finally{await f.close();}
});
