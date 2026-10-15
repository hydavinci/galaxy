import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SkyRenderer,bodyViewGeometry,cameraBasis} from '../src/observer/sky-renderer';
import {computeSky,DEFAULT_LOCATION} from '../src/observer/astronomy';
import {SATURN_RING_INNER,SATURN_RING_OUTER} from '../src/observer/saturn-rings';
import type {SkySettings,Vec3} from '../src/observer/types';
const settings:SkySettings={atmosphere:false,ground:false,refraction:false,milkyWay:false,labels:true,constellations:false,grid:false,mode:'visual',lightPollution:4};
class ImageFixture {
 static images:ImageFixture[]=[];onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
 naturalWidth=2048;naturalHeight=1024;src='';decoding='';crossOrigin='';
 constructor(){ImageFixture.images.push(this);}
 decode(){return Promise.resolve();}
 finish(){if(this.src.includes('saturn_ring'))this.naturalHeight=125;this.onload?.();}
}
function fixtureGL(){
 let id=0,program:any,blend=false;const shaders=new Map<any,string>(),uniforms=new Map<string,any>(),draws:any[]=[];
 const constants:any={MAX_TEXTURE_SIZE:3379,ALIASED_POINT_SIZE_RANGE:33901,BLEND:3042,TEXTURE0:33984,TEXTURE1:33985,ACTIVE_TEXTURE:34016,NO_ERROR:0};
 return {draws,gl:new Proxy({}, {get(_t,k:string){
  if(k in constants)return constants[k];if(k.toUpperCase()===k)return 1;
  if(k.startsWith('create'))return()=>({id:++id});if(k==='getError')return()=>0;
  if(k==='getParameter')return(p:number)=>p===3379?16384:p===33901?[1,64]:p===34016?33984:null;
  if(k==='getShaderParameter'||k==='getProgramParameter')return()=>true;
  if(k==='shaderSource')return(s:any,v:string)=>shaders.set(s,v);
  if(k==='attachShader')return(p:any,s:any)=>{p.source=(p.source??'')+shaders.get(s);};
  if(k==='useProgram')return(p:any)=>{program=p;};if(k==='getUniformLocation')return(_p:any,n:string)=>n;
  if(k.startsWith('uniform'))return(n:string,...v:any[])=>uniforms.set(n,v);
  if(k==='enable')return(n:number)=>{if(n===3042)blend=true;};if(k==='disable')return(n:number)=>{if(n===3042)blend=false;};
  if(k==='drawArrays')return()=>{if(program?.source?.includes('gl_FragDepth=u_depth'))draws.push({blend,uniforms:new Map(uniforms)});};
  return()=>{};
 }}) as WebGL2RenderingContext};
}
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

test('renderer requests real clouds/radial profile, uploads on frames, and submits ring-only offscreen-globe bounds',async()=>{
 const oldFetch=globalThis.fetch,oldImage=globalThis.Image;ImageFixture.images=[];globalThis.Image=ImageFixture as any;
 globalThis.fetch=async(input:any)=>new Response(await readFile(new URL(`../public/${String(input).replace(/^\.\//,'')}`,import.meta.url)));
 const {gl,draws}=fixtureGL(),events=new Map<string,()=>void>();
 const canvas={clientWidth:800,clientHeight:600,width:800,height:600,getContext:()=>gl,addEventListener:(n:string,f:()=>void)=>events.set(n,f),removeEventListener:()=>{}} as unknown as HTMLCanvasElement;
 const renderer=new SkyRenderer(canvas),camera={azimuthDeg:0,altitudeDeg:20,fovDeg:1};
 try {
  await renderer.init();assert.equal(ImageFixture.images.length,0,'init never blocks on planet imagery');
  const source=computeSky(new Date('2026-10-14T00:00:00Z'),DEFAULT_LOCATION),original=source.bodies.find(b=>b.id==='saturn')!;
  const b=cameraBasis(camera),tx=Math.tan(Math.PI/360)*800/600,nx=1+50*2/800;
  const raw=b.forward.map((v,i)=>v+b.right[i]*nx*tx) as Vec3,dir=raw.map(v=>v/Math.hypot(...raw)) as Vec3;
  const saturn={...original,direction:dir,angularDiameterRad:.1*Math.PI/180},state={...source,bodies:[saturn]};
  assert.equal(bodyViewGeometry(dir,Math.sin(saturn.angularDiameterRad/2),camera,800,600),null);
  renderer.render(state,camera,settings);assert.equal(draws.length,1,'ring still on screen despite whole globe being off screen');
  assert.ok(ImageFixture.images.some(i=>i.src.endsWith('2k_saturn_ring_alpha.png')));
  assert.ok(!ImageFixture.images.some(i=>/\/(4k|8k)_/.test(i.src)));
  for(let frame=0;frame<6;frame++){
   for(const image of ImageFixture.images)if(image.onload)image.finish();
   await flush();renderer.render(state,camera,settings);
  }
  const draw=draws.at(-1)!;assert.equal(draw.uniforms.get('u_hasRing')[0],1);assert.equal(draw.blend,true);
  assert.deepEqual(draw.uniforms.get('u_ringRadii'),[SATURN_RING_INNER,SATURN_RING_OUTER]);assert.equal(draw.uniforms.get('u_ringTexture')[0],1);
  assert.ok(draw.uniforms.get('u_axisNorth').every(Number.isFinite));assert.ok(draw.uniforms.get('u_rect').every((n:number)=>Number.isFinite(n)&&Math.abs(n)<=1));
  const venus={...source.bodies.find(b=>b.id==='venus')!,direction:b.forward,angularDiameterRad:.1*Math.PI/180};
  renderer.render({...source,bodies:[venus]},camera,settings);
  assert.equal(draws.at(-1)!.uniforms.get('u_hasRing')[0],0,'no stale Saturn uniform');
  assert.ok(ImageFixture.images.some(i=>i.src.endsWith('detail/2k_venus_atmosphere.jpg')));
  assert.ok(!ImageFixture.images.some(i=>/venus_surface/.test(i.src)));
  const before=draws.length;events.get('webglcontextlost')!();
  for(const image of ImageFixture.images)image.finish();await flush();renderer.render(state,camera,settings);
  assert.equal(draws.length,before);assert.match(renderer.getStats().status,/上下文丢失/);
 } finally {renderer.dispose();globalThis.Image=oldImage;globalThis.fetch=oldFetch;}
});

test('context loss during asynchronous catalog init cannot resurrect ready renderer',async()=>{
 const oldFetch=globalThis.fetch,oldImage=globalThis.Image;globalThis.Image=ImageFixture as any;
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 globalThis.fetch=async(input:any)=>{await gate;return new Response(await readFile(new URL(`../public/${String(input).replace(/^\.\//,'')}`,import.meta.url)));};
 const {gl,draws}=fixtureGL(),events=new Map<string,()=>void>(),canvas={width:800,height:600,clientWidth:800,clientHeight:600,getContext:()=>gl,addEventListener:(n:string,f:()=>void)=>events.set(n,f),removeEventListener:()=>{}} as unknown as HTMLCanvasElement;
 const renderer=new SkyRenderer(canvas);
 try{
  const pending=renderer.init();events.get('webglcontextlost')!();release();await pending;
  renderer.render(computeSky(new Date('2026-10-14T00:00:00Z'),DEFAULT_LOCATION),{azimuthDeg:0,altitudeDeg:0,fovDeg:60},settings);
  assert.equal(draws.length,0);assert.match(renderer.getStats().status,/上下文丢失/);
 }finally{release();renderer.dispose();globalThis.Image=oldImage;globalThis.fetch=oldFetch;}
});

// The manager's optional screen-position input comes from renderer geometry,
// not app gesture flags; retain ordinary moving-target tracking at tiny FOVs.
for(const dragging of [true,false])test(`deep-zoom ${dragging?'coherent pan stays base until held':'locked coherent tracking upgrades'} using true projected centre`,async()=>{
 const {PlanetTextureManager}=await import('../src/observer/planet-textures');
 ImageFixture.images=[];const {gl}=fixtureGL();
 const manager=new PlanetTextureManager(gl,{imageFactory:()=>new ImageFixture() as unknown as HTMLImageElement,deviceMemoryGiB:8,mobile:false});
 const camera={azimuthDeg:0,altitudeDeg:20,fovDeg:.0001};
 const demand=(x:number)=>[{id:'moon',devicePixelDiameter:2000,screenPosition:[x,0] as [number,number]}];
 try{
  manager.update(camera,demand(0),0);ImageFixture.images[0].finish();await flush();manager.update(camera,demand(0),16);
  assert.equal(manager.get('moon')?.tier,2);
  for(let i=2;i<=70;i++)manager.update({...camera,azimuthDeg:i*.000001},demand(dragging?i*.004:0),i*16);
  assert.equal(ImageFixture.images.some(i=>i.src.includes('8k_moon')),!dragging);
  if(dragging){
   manager.update({...camera,azimuthDeg:70*.000001},demand(70*.004),1500);
   assert.ok(ImageFixture.images.some(i=>i.src.includes('8k_moon')),'holding for 350ms allows upgrade');
  }
  assert.equal(manager.getStats().hdLoading,1);
 }finally{manager.dispose();}
});
