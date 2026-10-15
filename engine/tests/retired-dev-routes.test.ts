import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
const engine=fileURLToPath(new URL('../',import.meta.url));

test('actual Vite dev serves legacy directory variants as redirect-only, not SPA application fallback',async()=>{
 const server=await createServer({root:engine+'src',configFile:engine+'vite.config.ts',server:{host:'127.0.0.1',port:0,strictPort:false},optimizeDeps:{noDiscovery:true,include:[]}});
 try{
  await server.listen();const address=server.httpServer!.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  for(const namespace of ['space','observer'])for(const suffix of ['', '/', '/index.html']){
   const response=await fetch(`${base}/${namespace}${suffix}?next=https://outside.invalid/`,{redirect:'manual'});
   assert.equal(response.status,200);const body=await response.text();
   assert.equal(body,await readFile(engine+`public/${namespace}/index.html`,'utf8'));
   assert.doesNotMatch(body,/type="module"|\/app\.ts|<canvas|@vite\/client/);
   assert.match(body,/window\.location\.replace\('\/'\)/);
  }
  for(const pathname of ['/','/space-not-retired']){
   const response=await fetch(base+pathname);const body=await response.text();assert.match(body,/mode-root/);assert.match(body,/app\.ts/);assert.doesNotMatch(body,/window\.location\.replace/);
  }
  const head=await fetch(base+'/observer',{method:'HEAD',redirect:'manual'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 }finally{await server.close();}
});
