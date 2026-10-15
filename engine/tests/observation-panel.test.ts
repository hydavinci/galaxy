import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {ObservationPanel,observationImage,type ObservationRecord,surfaceEvidence} from '../src/space/observations';
const photo:ObservationRecord={id:'test-photo',kind:'observation-photo',title:'真实观测照片fixture',path:'./observations/photos/test.jpg',sourceUrl:'https://example.org/observation',imageSourceUrl:'https://example.org/raw.jpg',credit:'任务相机团队',license:'test license',licenseUrl:'https://example.org/license',capturedAt:'2000-01-01',processing:'三个波段合成',coverage:'仅一个半球',limitations:'不是实时天气，非全球表面图'};
async function fixture(){const w=new Window({url:'https://example.test/'}),d=w.document;d.body.innerHTML='<section id="observations"></section>';const root=d.getElementById('observations')!,p=new ObservationPanel(root as any,[photo]);return{w,d,p,root,button:()=>root.querySelector('button')!,image:()=>root.querySelector('img'),close:async()=>{p.dispose();await w.happyDOM.abort();}};}
test('observation metadata is present without downloading and contains date, coverage, processing and credit',async()=>{
 const f=await fixture();try{f.p.show(photo.id,true);assert.equal(f.image(),null);assert.match(f.root.textContent,/2000-01-01/);assert.match(f.root.textContent,/三个波段/);assert.match(f.root.textContent,/仅一个半球/);assert.match(f.root.textContent,/任务相机团队/);assert.match(f.root.textContent,/不作为球面贴图/);assert.equal(f.root.querySelector('a')!.getAttribute('href'),photo.sourceUrl);f.button().click();assert.equal(f.image()!.getAttribute('src'),photo.path);assert.equal(f.image()!.hidden,true);}finally{await f.close();}
});
test('late observation load cannot attach old picture to a different target or a closed panel',async()=>{
 const f=await fixture();try{f.p.show(photo.id,true);f.button().click();const img=f.image()!,late=img.onload!;Object.defineProperty(img,'naturalWidth',{value:600});Object.defineProperty(img,'naturalHeight',{value:400});f.p.show('hyg-6672',true);late.call(img,new f.w.Event('load') as any);assert.equal(f.image(),null);assert.match(f.root.textContent,/尚无已核验/);assert.equal(f.button().hidden,true);assert.equal(img.getAttribute('src'),null);
 f.p.show(photo.id,true);f.button().click();const again=f.image()!,another=again.onload!;f.p.show(photo.id,false);another.call(again,new f.w.Event('load') as any);assert.equal(f.root.hidden,true);assert.equal(f.image(),null);
 }finally{await f.close();}
});
test('success and load failure remain explicit and retry uses one current image only',async()=>{
 const f=await fixture();try{f.p.show(photo.id,true);f.button().click();let img=f.image()!;Object.defineProperty(img,'naturalWidth',{value:600});Object.defineProperty(img,'naturalHeight',{value:400});img.onload!.call(img,new f.w.Event('load') as any);assert.equal(img.hidden,false);assert.match(f.root.textContent,/影像已载入/);assert.equal(f.button().disabled,false);
 f.button().click();img=f.image()!;img.onerror!.call(img,new f.w.Event('error') as any);assert.equal(img.hidden,true);assert.match(f.root.textContent,/暂未载入/);assert.equal(img.getAttribute('src'),null);assert.equal(f.button().disabled,false);f.button().click();assert.equal(f.root.querySelectorAll('img').length,1);f.p.dispose();assert.equal(f.root.children.length,0);
 }finally{await f.close();}
});
test('unknown stellar surface stays explicitly unavailable, not replaced by another photo or random noise',()=>{
 assert.equal(observationImage('hyg-6672',[photo]),undefined);assert.match(surfaceEvidence('hyg-6672',true),/无可用表面影像/);assert.match(surfaceEvidence('hyg-6672',true),/仅尺寸\/颜色示意/);
});
