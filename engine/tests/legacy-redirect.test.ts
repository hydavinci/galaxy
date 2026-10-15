import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {Window} from 'happy-dom';
const root=new URL('../public/',import.meta.url);
for(const path of ['space/','space/index.html','observer/','observer/index.html'])test(`retired ${path} only replaces location with main page, without starting another app`,async()=>{
 const html=await readFile(new URL(path.endsWith('/')?path+'index.html':path,root),'utf8');
 const documentURL='https://galaxy.example/'+path+'?next=https://outside.invalid/#observer';
 const w=new Window({url:documentURL});try{
  w.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
  assert.equal(w.document.querySelector('canvas,iframe,script[type=module],link[rel=stylesheet]'),null);
  const refresh=w.document.querySelector('meta[http-equiv=refresh]');assert.equal(refresh?.getAttribute('content'),'0;url=/');
  assert.equal(w.document.querySelector('link[rel=canonical]')?.getAttribute('href'),'/');
  assert.equal(w.document.querySelector('a')?.getAttribute('href'),'/');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);
  const targets:string[]=[];runInNewContext(scripts[0][1],{window:{location:{href:documentURL,replace:(url:string)=>targets.push(url)}}},{timeout:100});
  assert.deepEqual(targets,['/']);assert.equal(new URL(targets[0],documentURL).href,'https://galaxy.example/','query/hash cannot turn redirect into another site or retired path');
  assert.ok(Buffer.byteLength(html)<1000);assert.doesNotMatch(html,/src=|fetch\(|WebGL|requestAnimationFrame/);
 }finally{await w.happyDOM.abort();}
});
