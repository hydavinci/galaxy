import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {ObservationPanel,observationImages,observationImage,type ObservationRecord} from '../src/space/observations';
const photo:ObservationRecord={id:'earth',kind:'observation-photo',imageId:'a',title:'地球观测A',path:'./observations/photos/a.jpg',sourceUrl:'https://example.org/a',imageSourceUrl:'https://example.org/image-a',credit:'Camera A',license:'L-A',licenseUrl:'https://example.org/license-a',capturedAt:'2001-01-01',processing:'可见光',coverage:'可见半球A',limitations:'历史观测非实时'};
const second={...photo,imageId:'b',title:'地球观测B',path:'./observations/gallery/inner/b.jpg',sourceUrl:'https://example.org/b',credit:'Camera B',capturedAt:'2002-02-02',processing:'紫外假色',coverage:'北半球局部',license:'L-B'};
const map:ObservationRecord={...photo,kind:'global-map',imageId:'m',title:'地球地图',path:undefined,tiers:{2:'./observations/maps/earth-2k.jpg'},capturedAt:'2004年8月'};
const mars={...photo,id:'mars',imageId:'mars-a',title:'火星观测',path:'./observations/gallery/inner/mars.jpg'};
async function fixture(){const w=new Window({url:'https://example.test/'});w.document.body.innerHTML='<section id="p"></section>';const root=w.document.getElementById('p')!;const p=new ObservationPanel(root as any,[map,photo,second,mars]);const action=(a:string)=>root.querySelector(`[data-observation-action="${a}"]`) as any;return{w,root,p,action,images:()=>[...root.querySelectorAll('img')],close:async()=>{p.dispose();await w.happyDOM.abort();}};}
function succeed(f:Awaited<ReturnType<typeof fixture>>){const i=f.images()[0];assert.ok(i);Object.defineProperty(i,'naturalWidth',{value:800});Object.defineProperty(i,'naturalHeight',{value:600});i.onload!.call(i,new f.w.Event('load') as any);return i;}
test('gallery orders existing photos before map, keeps default first photo and retains independent map type',()=>{
 assert.deepEqual(observationImages('earth',[map,photo,second]).map(r=>r.imageId),['a','b','m']);assert.equal(observationImage('earth',[map,photo,second]),photo);assert.deepEqual(observationImages('unknown',[photo]),[]);
});
test('multiple image navigation changes source/date/title without starting unsolicited image requests',async()=>{
 const f=await fixture();try{f.p.show('earth',true);assert.equal(f.root.dataset.observationCount,'3');assert.equal(f.root.dataset.observationKey,'a');assert.equal(f.images().length,0);assert.equal(f.action('previous').disabled,true);
 f.action('next').click();assert.equal(f.root.dataset.observationKey,'b');assert.match(f.root.textContent,/2002-02-02/);assert.match(f.root.textContent,/Camera B/);assert.match(f.root.textContent,/紫外假色/);assert.equal(f.root.querySelector('a')!.getAttribute('href'),second.sourceUrl);assert.equal(f.images().length,0);
 f.action('next').click();assert.equal(f.root.dataset.observationKey,'m');assert.equal(f.action('next').disabled,true);assert.match(f.root.textContent,/拼接图/);f.action('previous').click();assert.equal(f.root.dataset.observationKey,'b');assert.equal(f.images().length,0);
 }finally{await f.close();}
});
test('after explicit viewing, each next/previous choice loads only that image and discards older same-target callbacks',async()=>{
 const f=await fixture();try{f.p.show('earth',true);f.action('load').click();const old=f.images()[0],late=old.onload!;assert.equal(old.getAttribute('src'),photo.path);
 f.action('next').click();assert.equal(f.images().length,1);const now=f.images()[0];assert.equal(now.getAttribute('src'),second.path);assert.equal(old.getAttribute('src'),null);late.call(old,new f.w.Event('load') as any);assert.equal(now.hidden,true);succeed(f);assert.equal(now.hidden,false);
 f.action('next').click();assert.equal(f.images().length,1);assert.equal(f.images()[0].getAttribute('src'),map.tiers![2]);assert.match(f.root.textContent,/2004年8月/);
 f.action('previous').click();assert.equal(f.images().length,1);assert.equal(f.images()[0].getAttribute('src'),second.path);
 }finally{await f.close();}
});
test('selector uses matching record and preserves input focus; invalid and same indices do not reload',async()=>{
 const f=await fixture();try{f.p.show('earth',true);f.action('load').click();succeed(f);const select=f.action('select');select.focus();select.value='1';select.dispatchEvent(new f.w.Event('change'));assert.equal(f.w.document.activeElement,select);assert.equal(f.root.dataset.observationKey,'b');const img=f.images()[0];select.dispatchEvent(new f.w.Event('change'));assert.ok(f.images()[0]===img,"selected image identity must remain stable");select.value='99';select.dispatchEvent(new f.w.Event('change'));assert.ok(f.images()[0]===img,"selected image identity must remain stable");assert.equal(f.root.dataset.observationIndex,'1');assert.equal(select.value,'1');
 }finally{await f.close();}
});
test('target change, unknown object, close and disposal cancel prior image and do not carry eager-load activation',async()=>{
 const f=await fixture();try{f.p.show('earth',true);f.action('load').click();f.action('next').click();const old=f.images()[0],late=old.onerror!;f.p.show('mars',true);assert.equal(f.root.dataset.observationCount,'1');assert.equal(f.images().length,0);late.call(old,new f.w.Event('error') as any);assert.doesNotMatch(f.root.textContent,/暂未载入/);assert.equal(f.root.querySelector('.observation-gallery-nav')!.hasAttribute('hidden'),true);f.action('load').click();f.p.show('hyg-6672',true);assert.equal(f.images().length,0);assert.equal(f.root.dataset.observationCount,'0');assert.match(f.root.textContent,/尚无已核验/);assert.equal(f.root.querySelector('a')!.getAttribute('href'),null);
 f.p.show('earth',true);assert.equal(f.root.dataset.observationKey,'a');assert.equal(f.images().length,0);f.action('load').click();f.p.show('earth',false);assert.equal(f.images().length,0);assert.equal(f.root.hidden,true);f.p.show('earth',true);assert.equal(f.images().length,0);f.p.dispose();assert.equal(f.root.children.length,0);
 }finally{await f.close();}
});
test('obsolete saved load-button closure cannot reload another image of the same object',async()=>{
 const f=await fixture();try{f.p.show('earth',true);const previousHandler=f.action('load').onclick;f.action('next').click();previousHandler.call(f.action('load'),new f.w.Event('click'));assert.equal(f.images().length,0);f.action('load').click();assert.equal(f.images()[0].getAttribute('src'),second.path);
 }finally{await f.close();}
});
for(const terminal of ['error','zero-size','timeout','success'] as const)test(`terminal ${terminal} cannot be reversed by a saved callback from the same request`,async()=>{
 const f=await fixture();try{
  let deadline:(()=>void)|undefined;const set=f.w.setTimeout.bind(f.w);f.w.setTimeout=((fn:any,ms:number,...args:any[])=>{if(ms===15000)deadline=()=>fn(...args);return set(fn,ms,...args);}) as any;
  f.p.show('earth',true);f.action('load').click();const image=f.images()[0],lateLoad=image.onload!,lateError=image.onerror!;
  if(terminal==='success')succeed(f);else if(terminal==='timeout'){assert.ok(deadline);deadline();}else if(terminal==='error')lateError.call(image,new f.w.Event('error') as any);else lateLoad.call(image,new f.w.Event('load') as any);
  const snapshot={hidden:image.hidden,src:image.getAttribute('src'),status:f.root.querySelector('[role="status"]')!.textContent};
  if(terminal!=='success'){Object.defineProperty(image,'naturalWidth',{configurable:true,value:800});Object.defineProperty(image,'naturalHeight',{configurable:true,value:600});}
  const unchanged=()=>assert.deepEqual({hidden:image.hidden,src:image.getAttribute('src'),status:f.root.querySelector('[role="status"]')!.textContent},snapshot);
  lateLoad.call(image,new f.w.Event('load') as any);unchanged();lateError.call(image,new f.w.Event('error') as any);unchanged();deadline?.();unchanged();
  assert.equal(f.action('load').disabled,false);f.action('load').click();assert.equal(f.images().length,1);assert.ok(f.images()[0]!==image);assert.equal(f.images()[0].getAttribute('src'),photo.path);succeed(f);assert.equal(f.images()[0].hidden,false);
 }finally{await f.close();}
});
