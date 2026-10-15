import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {SpacecraftLibrary,filterSpacecraft,safeSpacecraftSource,type SpacecraftRecord,type SpacecraftData} from '../src/space/spacecraft';
const first:SpacecraftRecord={id:'voyager-1',name:'旅行者1号',nameEn:'Voyager 1',agency:'NASA / JPL',category:'probe',launchDate:'1977-09-05',missionType:'外行星与星际探测器',targetNames:['木星','土星','星际空间'],relatedBodyIds:['jupiter','saturn'],summary:'历史任务摘要，不是实时遥测。',instruments:['磁强计','等离子体波仪'],achievements:['已核验的历史结果'],milestones:[{date:'1977-09-05',label:'发射'}],sources:[{label:'NASA 任务资料',url:'https://science.nasa.gov/mission/voyager/voyager-1/'}],limitations:'本卡不提供实时位置或轨道。'};
const rover:SpacecraftRecord={...first,id:'perseverance',name:'毅力号',nameEn:'Perseverance',category:'rover',launchDate:'2020-07-30',missionType:'火星巡视器',targetNames:['火星'],relatedBodyIds:['mars'],instruments:['SuperCam','PIXL'],summary:'巡视器而非环绕器。'};
const telescope:SpacecraftRecord={...first,id:'hubble',name:'哈勃空间望远镜',nameEn:'Hubble Space Telescope',category:'telescope',targetNames:['宇宙'],relatedBodyIds:['earth']};
const data:SpacecraftData={schemaVersion:1,verifiedOn:'2026-10-15',notice:'历史资料，不提供实时位置、轨道或遥测。',records:[first,rover,telescope]};
async function fixture(source=data){const w=new Window({url:'https://galaxy.test/'});w.document.body.innerHTML='<div id="library"></div>';const root=w.document.getElementById('library')!,library=new SpacecraftLibrary(root as any,source);const action=(name:string)=>root.querySelector(`[data-spacecraft-action="${name}"]`) as any;const titles=()=>[...root.querySelectorAll('article')].map(e=>e.dataset.spacecraftId);return{w,root,library,action,titles,close:async()=>{library.dispose();await w.happyDOM.abort();}};}
test('mission matching supports Chinese, normalized English, agency and instruments, intersecting category and body',()=>{
 assert.equal(filterSpacecraft(data.records,'Voyager-1').length,1);assert.equal(filterSpacecraft(data.records,'旅行者 1').length,1);assert.equal(filterSpacecraft(data.records,'voyager 1')[0],first);assert.equal(filterSpacecraft(data.records,'supercam')[0],rover);assert.equal(filterSpacecraft(data.records,'NASA').length,3);
 assert.deepEqual(filterSpacecraft(data.records,'','probe','mars'),[]);assert.deepEqual(filterSpacecraft(data.records,'','rover','mars'),[rover]);assert.deepEqual(filterSpacecraft(data.records,'未知'),[]);
});
test('library mounts bounded text cards with historical dates, instruments, achievements and source links; no images or embeds',async()=>{
 const f=await fixture();try{assert.equal(f.root.dataset.spacecraftCount,'3');assert.deepEqual(f.titles(),['voyager-1','perseverance','hubble']);assert.equal(f.root.querySelectorAll('img,canvas,iframe,script').length,0);assert.match(f.root.textContent,/资料核对：2026-10-15/);assert.match(f.root.textContent,/不提供实时位置/);
 const card=f.root.querySelector('[data-spacecraft-id="voyager-1"]')!;for(const text of [first.name,first.nameEn,first.agency,first.summary,first.launchDate,...first.instruments,...first.achievements,first.limitations])assert.ok(card.textContent.includes(text));assert.equal(card.querySelector('time')!.getAttribute('datetime'),'1977-09-05');const a=card.querySelector('a')!;assert.equal(a.getAttribute('href'),first.sources[0].url);assert.equal(a.rel,'noopener noreferrer');assert.equal(a.target,'_blank');assert.equal(f.root.querySelectorAll('details').length,3);
 }finally{await f.close();}
});
test('search/category/body changes retain focus and never trigger parent keyboard actions',async()=>{
 const f=await fixture();try{const input=f.action('search');input.focus();input.value='毅力';input.dispatchEvent(new f.w.Event('input'));assert.deepEqual(f.titles(),['perseverance']);assert.ok(f.w.document.activeElement===input);
 const category=f.action('category');category.focus();category.value='telescope';category.dispatchEvent(new f.w.Event('change'));assert.equal(f.root.dataset.spacecraftCount,'0');assert.ok(f.w.document.activeElement===category);assert.match(f.root.textContent,/没有匹配/);
 f.action('reset').click();assert.equal(f.root.dataset.spacecraftCount,'3');assert.ok(f.w.document.activeElement===input);f.action('body').value='mars';f.action('body').dispatchEvent(new f.w.Event('change'));assert.deepEqual(f.titles(),['perseverance']);assert.match(f.root.textContent,/火星相关/);
 }finally{await f.close();}
});
test('contextual open resets old filters to exact related body, unassociated objects fall back to all records',async()=>{
 const f=await fixture();try{assert.equal(f.library.relatedCount('mars'),1);assert.equal(f.library.relatedCount('saturn'),1);assert.equal(f.library.relatedCount('hyg-6672'),0);f.library.reset('saturn');assert.deepEqual(f.titles(),['voyager-1']);assert.equal(f.action('body').value,'saturn');f.action('search').value='Hubble';f.action('category').value='telescope';f.library.reset('mars');assert.equal(f.action('search').value,'');assert.equal(f.action('category').value,'all');assert.deepEqual(f.titles(),['perseverance']);f.library.reset('bogus');assert.equal(f.action('body').value,'all');assert.equal(f.titles().length,3);
 }finally{await f.close();}
});
test('invalid selector values restore all without corrupting the current input',async()=>{
 const f=await fixture();try{for(const name of ['category','body']){f.action(name).value='bogus';f.action(name).dispatchEvent(new f.w.Event('change'));assert.equal(f.action(name).value,'all');assert.equal(f.titles().length,3);}}finally{await f.close();}
});
test('metadata is rendered as inert text; unsafe source schemes and credential-bearing links are rejected',async()=>{
 assert.equal(safeSpacecraftSource('https://science.nasa.gov/mission/juno/'),true);for(const url of ['javascript:alert(1)','http://example.com','data:text/html,test','https://user:pass@example.com','not-a-url'])assert.equal(safeSpacecraftSource(url),false,url);
 const malicious={...first,name:'<img src=x onerror=alert(1)>',summary:'<script>bad()</script>',sources:[{label:'<b>label</b>',url:'https://example.com/'},{label:'bad',url:'javascript:bad()'}]};const f=await fixture({...data,records:[malicious]});try{assert.equal(f.root.querySelectorAll('img,script,b').length,0);assert.ok(f.root.textContent.includes(malicious.name));assert.equal(f.root.querySelectorAll('a').length,1);assert.equal(f.root.querySelector('a')!.textContent,'<b>label</b> ↗');}finally{await f.close();}
});
test('repeated resets and disposal do not leave duplicate cards or resurrect detached handlers',async()=>{
 const f=await fixture();try{for(let i=0;i<20;i++){f.library.reset(i%2?'mars':'saturn');assert.equal(f.titles().length,1);}const input=f.action('search'),handler=input.oninput,reset=f.action('reset').onclick;f.library.dispose();f.library.dispose();handler();reset();f.library.reset();f.library.focus();assert.equal(f.root.children.length,0);assert.equal(input.oninput,null);assert.equal(f.root.dataset.spacecraftCount,undefined);}finally{await f.close();}
});
