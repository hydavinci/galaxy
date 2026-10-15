// Executes the packaged JS and real renderer against a MOCK GL in a DOM model.
// It proves asset/bootstrap wiring only. No shader compilation, browser or pixels.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Optional legacy observer-package check, NOT part of npm test. Supply a local
// generated artifact explicitly; it is not a dependency of a clean checkout.
const [input,...extra]=process.argv.slice(2);
if(!input||extra.length)throw new Error('Usage: node tests/package-smoke.mjs /path/to/Galaxy-Observer-Preview.html');
const artifact=resolve(input);
const output=new URL('../test-results/package-smoke/',import.meta.url);
const html=await fs.readFile(artifact,'utf8');
const map=JSON.parse(html.match(/<script>globalThis\.__GALAXY_ASSETS__=(.*?);<\/script>/s)[1]);
const code=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const window=new Window({url:'file:///Galaxy-Observer-Preview.html',width:1440,height:900});
const document=window.document;
document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
let serial=1,drawCalls=0,shaderSources=0,requestCount=0;
const constants=new Map();
const gl=new Proxy({}, {get(target,key){
 if(key==='getParameter')return ()=>new Float32Array([1,256]);
 if(key==='getShaderParameter'||key==='getProgramParameter')return ()=>true;
 if(key==='getShaderInfoLog'||key==='getProgramInfoLog')return ()=>'';
 if(key==='getUniformLocation')return (_p,name)=>({name});
 if(key==='getAttribLocation')return (_p,name)=>name==='a_uv'?1:0;
 if(key==='isContextLost')return ()=>false;
 if(String(key).startsWith('create'))return ()=>({id:serial++});
 if(key==='shaderSource')return ()=>shaderSources++;
 if(key==='drawArrays'||key==='drawElements')return ()=>drawCalls++;
 if(/^[A-Z_0-9]+$/.test(String(key))){if(!constants.has(key))constants.set(key,constants.size+1);return constants.get(key);}
 return ()=>{};
}});
const canvas=document.getElementById('sky');canvas.getContext=()=>gl;
Object.defineProperties(canvas,{clientWidth:{value:1440},clientHeight:{value:900}});
Object.defineProperty(document,'hidden',{value:false});
window.__GALAXY_ASSETS__=map;
window.fetch=async(url,options)=>{assert.match(String(url),/^data:/,'packaged local asset should be embedded');requestCount++;const response=await fetch(url);return {ok:response.ok,status:response.status,json:()=>response.json(),arrayBuffer:async()=>{const data=new Uint8Array(await response.arrayBuffer());const copy=new window.Uint8Array(data.length);copy.set(data);return copy.buffer;}};};
window.Image=class {onload=null;onerror=null;crossOrigin='';width=2048;height=1024;naturalWidth=2048;naturalHeight=1024;_src='';set src(value){this._src=value;if(!value)return;queueMicrotask(()=>{if(value.startsWith('data:'))this.onload?.();else this.onerror?.();});}get src(){return this._src;}};
let raf;
window.requestAnimationFrame=fn=>{raf=fn;return 1;};window.cancelAnimationFrame=()=>{};
window.eval(code);
for(let i=0;i<80&&!document.body.dataset.ready;i++)await new Promise(r=>setImmediate(r));
assert.equal(document.body.dataset.ready,'true',document.getElementById('loading-text').textContent);
const app=window.__galaxy;
assert.equal(app.stats.catalogCount,115517);assert.equal(requestCount,6);
app.setDate('2026-10-13T13:00:00Z');
let now=window.performance.now();
for(let i=0;i<5;i++){now+=300;const fn=raf;raf=undefined;fn?.(now);await new Promise(r=>setImmediate(r));}
assert.equal(document.body.dataset.ready,'true');assert.ok(drawCalls>0);assert.equal(app.state.date.toISOString(),'2026-10-13T13:00:00.000Z');
const search=document.getElementById('search');search.value='月亮';search.dispatchEvent(new window.Event('input',{bubbles:true}));document.querySelector('#search-results button').click();
assert.equal(app.selected.id,'moon');assert.match(document.getElementById('object-facts').textContent,/受光比例/);
const report={ok:true,packagedBootstrap:true,realAppAndRendererCode:true,mockedGL:true,browserVerified:false,gpuVerified:false,catalogStars:app.stats.catalogCount,localDataFetches:requestCount,shaderSourcesSubmittedToMock:shaderSources,drawCallsOnMock:drawCalls,moonSearch:true,hiPSNetworkSimulatedFailure:true};
await fs.mkdir(output,{recursive:true});
await fs.writeFile(new URL('package-dom-smoke.json',output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,reportDirectory:fileURLToPath(output)},null,2));
await window.happyDOM.abort();
