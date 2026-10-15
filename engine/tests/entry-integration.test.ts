import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {Window} from 'happy-dom';
import config from '../vite.config';
const engine=fileURLToPath(new URL('../',import.meta.url));

test('one 3D-only application entry and no observer import or switch recovery UI',async()=>{
 const root=await readFile(engine+'src/index.html','utf8'),entry=await readFile(engine+'src/app.ts','utf8');
 assert.match(root,/id="mode-root"/);assert.match(root,/id="main-retry"/);assert.match(root,/src="\/app.ts"/);
 assert.doesNotMatch(root,/main-mode-nav|data-switch-mode|观星模式|<iframe/);
 assert.deepEqual((config as any).build.rollupOptions.input,{main:'src/index.html'});
 for(const path of ['src/space/index.html','src/observer/index.html','src/observer/entry.ts','src/modes/observer.html'])await assert.rejects(access(engine+path));
 assert.match(entry,/import\('\.\/space\/app'\)/);
 assert.doesNotMatch(entry,/import\('\.\/observer|switchMode|data-switch-mode/);
 assert.doesNotMatch(entry,/location\s*\.|history\s*\.|<iframe|\?mode/);
 assert.match(entry,/void main\.retry\(\)/);
});
test('the sole spatial UI template keeps 3D controls, not any observer entry or effect toggle',async()=>{
 const html=await readFile(engine+'src/modes/space.html','utf8');
 assert.doesNotMatch(html,/<(?:html|head|body|script|iframe)\b/i);
 const w=new Window({url:'https://galaxy.example/'});try{
  w.document.write(html);assert.equal(w.document.querySelectorAll('canvas').length,1);assert.ok(w.document.getElementById('space-canvas'));
  assert.equal(w.document.querySelector('[data-switch-mode],#observer-mode-link,#space-cinematic,#earth-dialog,#sky'),null);
  for(const id of ['space-objects','space-mode','space-label-toggle','space-rewind','space-pause','space-forward','space-now','space-nearer','space-farther','space-earth','space-system'])assert.ok(w.document.getElementById(id),id);
 }finally{await w.happyDOM.abort();}
});
test('root catalogs/credits keep same-origin resolution while legacy endpoints are redirect-only',async()=>{
 const shell=await readFile(engine+'src/index.html','utf8'),html=await readFile(engine+'src/modes/space.html','utf8');
 const w=new Window({url:'https://galaxy.example/'});try{
  w.document.write(shell.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));w.document.getElementById('mode-root')!.innerHTML=html;
  assert.equal(w.document.baseURI,'https://galaxy.example/');
  for(const rel of ['./data/space-stars.json','./observations/maps/earth-2k.jpg','./observations/maps/moon-4k.jpg'])assert.equal(new URL(rel,w.document.baseURI).pathname,rel.slice(1));
  const credit=w.document.querySelector('a[href="./data/observation-gallery-credits.json"]');assert.ok(credit);
  assert.equal(new URL(credit.getAttribute('href')!,w.document.baseURI).href,'https://galaxy.example/data/observation-gallery-credits.json');
 }finally{await w.happyDOM.abort();}
});
test('only spatial stylesheet/template can enter the main graph; archived observer fixtures cannot auto-start',async()=>{
 const coordinator=await readFile(engine+'src/app.ts','utf8');
 assert.match(coordinator,/import\('\.\/space\/style\.css\?inline'\)/);assert.match(coordinator,/import\('\.\/modes\/space\.html\?raw'\)/);
 assert.doesNotMatch(coordinator,/\.\/observer\/|\.\/modes\/observer/);
 assert.match(coordinator,/this\.style\.textContent = css\.default/);
 const app=await readFile(engine+'src/space/app.ts','utf8');assert.doesNotMatch(app,/void startSpace\(\)/);
 assert.match(await readFile(engine+'tests/fixtures/space-entry.ts','utf8'),/void startSpace\(\)/);
});
