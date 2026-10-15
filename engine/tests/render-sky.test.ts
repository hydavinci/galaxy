import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CATALOG_LEVELS,CATALOG_STAR_COUNT,SkyRenderer,angularDiameterCssPixels,apparentDirection,cameraBasis,equatorialDirection,horizontalDirection,projectDirection,projectedIlluminatedFraction,skyPhotometry,transformDirection,validateCatalog} from '../src/observer/sky-renderer';
import {computeSky,DEFAULT_LOCATION,refractedAltitude,starHorizontal} from '../src/observer/astronomy';
import {BODY_FRAG,REFRACTION_GLSL,STAR_VERT} from '../src/observer/shaders/sky';
import type {CameraState,SkyBody,SkySettings,SkyState,Vec3} from '../src/observer/types';
const RAD=Math.PI/180;
const settings:SkySettings={atmosphere:true,ground:true,refraction:true,milkyWay:true,labels:true,constellations:true,grid:true,mode:'visual',lightPollution:1};
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const near=(a:number,b:number,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const nearVec=(a:Vec3,b:Vec3,tol=1e-8)=>a.forEach((x,i)=>near(x,b[i],tol));

test('horizon axes, camera orientation, CSS projection and ground visibility agree',()=>{
 nearVec(horizontalDirection(0,0),[0,0,-1]);nearVec(horizontalDirection(90,0),[1,0,0]);nearVec(horizontalDirection(180,0),[0,0,1]);nearVec(horizontalDirection(270,0),[-1,0,0]);nearVec(horizontalDirection(0,90),[0,1,0]);
 for(const az of [0,90,180,270,359])for(const alt of [-70,0,45,89.9]){
  const c={azimuthDeg:az,altitudeDeg:alt,fovDeg:60},p=projectDirection(horizontalDirection(az,alt),c,800,600);
  near(p.x,400);near(p.y,300);assert.equal(p.visible,true);
  assert.equal(projectDirection(horizontalDirection(az+180,-alt),c,800,600).visible,false);
  const basis=cameraBasis(c);near(Math.hypot(...basis.right),1);near(Math.hypot(...basis.up),1);near(Math.hypot(...basis.forward),1);
 }
 const c={azimuthDeg:0,altitudeDeg:0,fovDeg:60};
 assert.ok(projectDirection(horizontalDirection(10,0),c,800,600).x>400);assert.ok(projectDirection(horizontalDirection(0,10),c,800,600).y<300);
 assert.equal(projectDirection(horizontalDirection(0,-1),c,800,600,true).visible,false);assert.equal(projectDirection(horizontalDirection(0,-1),c,800,600,false).visible,true);
});

test('CPU projection and shader refraction reproduce shared science at the horizon and poles',()=>{
 for(const altitude of [-90,-45,-5,-1,-.5,0,3,20,70,89.9,90]){
  const h=Math.max(-1,altitude);let r=1.02/Math.tan((h+10.3/(h+5.11))*RAD)/60;if(altitude<-1)r*=(altitude+90)/89;
  const shaderAltitude=Math.min(90,Math.max(-90,altitude+Math.max(0,r)));near(shaderAltitude,refractedAltitude(altitude),1e-10);
  const p=apparentDirection(horizontalDirection(110,altitude),true);near(Math.asin(Math.max(-1,Math.min(1,p[1])))/RAD,shaderAltitude,1e-8);
  nearVec(apparentDirection(horizontalDirection(110,altitude),false),horizontalDirection(110,altitude));
 }
 assert.match(REFRACTION_GLSL,/max\(0\.0, correction\)/);
 const state=computeSky(new Date('2026-10-13T14:00:00Z'),DEFAULT_LOCATION);
 for(const[ra,dec]of [[1.2,.5],[4.4,-.2],[0,.9]]){
  const h=starHorizontal({id:'test',name:'test',magnitude:1,raRad:ra,decRad:dec},state,true);
  const p=apparentDirection(transformDirection(state.equatorialToHorizontal,equatorialDirection(ra,dec)),true);
  near(Math.asin(p[1])/RAD,h.apparentAltitudeDeg,1e-5);
 }
});

test('five existing real LOD files validate exactly 115517 headerless catalog stars',async()=>{
 let count=0;
 for(const level of CATALOG_LEVELS){const bytes=await readFile(new URL(`../public/data/${level.file}`,import.meta.url));count+=validateCatalog(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),level.count).length/4;}
 assert.equal(count,CATALOG_STAR_COUNT);assert.equal(count,115517);assert.deepEqual(CATALOG_LEVELS.map(x=>x.file),[0,1,2,3,4].map(i=>`stars-lod${i}.bin`));
 assert.throws(()=>validateCatalog(new ArrayBuffer(17),1),/目录长度异常/);assert.throws(()=>validateCatalog(new Float32Array([0,NaN,1,0]).buffer,1),/目录记录异常/);
});

test('Sun altitude, pollution, exposure mode and moderate FOV gain govern stars',()=>{
 const night=skyPhotometry(-25,settings,60),twilight=skyPhotometry(-10,settings,60),day=skyPhotometry(25,settings,60);
 assert.equal(night.starVisibility,1);assert.equal(day.starVisibility,0);assert.ok(twilight.starVisibility>0&&twilight.starVisibility<1);assert.ok(night.limitingMagnitude>twilight.limitingMagnitude&&twilight.limitingMagnitude>day.limitingMagnitude);
 const polluted=skyPhotometry(-25,{...settings,lightPollution:9},60);assert.ok(polluted.limitingMagnitude<night.limitingMagnitude);assert.ok(polluted.milkyWayOpacity<night.milkyWayOpacity);
 const zoom=skyPhotometry(-25,settings,.1),enhanced=skyPhotometry(-25,{...settings,mode:'enhanced'},.1);
 assert.ok(zoom.limitingMagnitude>night.limitingMagnitude&&zoom.limitingMagnitude<=7.9);assert.ok(enhanced.limitingMagnitude>zoom.limitingMagnitude&&enhanced.limitingMagnitude<=11);
 assert.equal(skyPhotometry(70,{...settings,atmosphere:false},60).starVisibility,1);assert.match(STAR_VERT,/pow\(10\.0,-0\.4\*effectiveMag\)/);assert.doesNotMatch(STAR_VERT.replace(/\/\/[^\n]*/g,''),/random|normMag/);
});

test('actual angular sizes and physical target-to-Sun lighting yield thin crescents',()=>{
 near(angularDiameterCssPixels(.5*RAD,60,800),800*Math.tan(.25*RAD)/Math.tan(30*RAD));assert.ok(angularDiameterCssPixels(.5*RAD,60,800)<7);assert.ok(angularDiameterCssPixels(50/3600*RAD,60,800)<.2);assert.ok(angularDiameterCssPixels(.5*RAD,1,800)>399);
 const dir:Vec3=[0,0,-1];assert.equal(projectedIlluminatedFraction(dir,[0,0,-1]),0);assert.equal(projectedIlluminatedFraction(dir,[0,0,1]),1);assert.equal(projectedIlluminatedFraction(dir,[1,0,0]),.5);
 const sun:Vec3=[Math.sin(10*RAD),0,-Math.cos(10*RAD)+.00257],fraction=projectedIlluminatedFraction(dir,sun);assert.ok(fraction>.007&&fraction<.009);
 const length=Math.hypot(...sun);let lit=0,total=0;
 for(let y=-.999;y<1;y+=.003)for(let x=-.999;x<1;x+=.003)if(x*x+y*y<1){const n=[x,y,Math.sqrt(1-x*x-y*y)];if(n.reduce((v,n,i)=>v+n*sun[i]/length,0)>0)lit++;total++;}
 near(lit/total,fraction,.0005);assert.match(BODY_FRAG,/dot\(n,normalize\(u_light\)\)/);assert.match(BODY_FRAG,/acos\(clamp\(dot\(n,u_axisNorth\)/);assert.doesNotMatch(BODY_FRAG,/illuminatedFraction/);
});

// Protocol mock only: no GLSL compilation/rasterization or GPU visual claim.
function mockContext(){
 let id=0,current:any=null,active=33984,depthMask=true,vao:any=null;
 const enabled=new Set<number>(),bindings=new Map<number,any>(),sources=new Map<any,string>(),uniforms=new Map<string,any>(),draws:any[]=[],calls:string[]=[];
 const constants:Record<string,number>={VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:35713,LINK_STATUS:35714,ALIASED_POINT_SIZE_RANGE:33901,MAX_TEXTURE_SIZE:3379,TEXTURE1:33985,NO_ERROR:0,DEPTH_TEST:2929,CULL_FACE:2884,SCISSOR_TEST:3089,BLEND:3042,DEPTH_WRITEMASK:2930,CURRENT_PROGRAM:35725,VERTEX_ARRAY_BINDING:34229,ARRAY_BUFFER_BINDING:34964,ACTIVE_TEXTURE:34016,TEXTURE_BINDING_2D:32873,TEXTURE0:33984,ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,TEXTURE_2D:3553,POINTS:0,LINES:1,TRIANGLES:4};
 const created:Record<string,number>={},deleted:Record<string,number>={};
 const gl:any=new Proxy({}, {get(_,name:string){
  if(name in constants)return constants[name];if(name.toUpperCase()===name)return 1;
  if(name==='getParameter')return(key:number)=>key===33901?new Float32Array([1,64]):key===3379?16384:key===2930?depthMask:key===35725?current:key===34229?vao:key===34964?bindings.get(34962)??null:key===34016?active:key===32873?bindings.get(3553)??null:null;
  if(name==='isEnabled')return(key:number)=>enabled.has(key);
  if(name==='getShaderParameter'||name==='getProgramParameter')return()=>true;
  if(name==='getError')return()=>0;
  if(name==='getAttribLocation')return(_p:any,a:string)=>a==='a_uv'?1:0;
  if(name==='getUniformLocation')return(_p:any,u:string)=>u;
  if(name==='shaderSource')return(shader:any,source:string)=>sources.set(shader,source);
  if(name==='attachShader')return(p:any,s:any)=>{p.sources??=[];p.sources.push(sources.get(s));};
  if(name.startsWith('create'))return()=>{calls.push(name);created[name]=(created[name]??0)+1;return{id:++id};};
  if(name.startsWith('delete'))return()=>{deleted[name]=(deleted[name]??0)+1;};
  if(name==='useProgram')return(p:any)=>{current=p;};
  if(name==='enable')return(c:number)=>enabled.add(c);if(name==='disable')return(c:number)=>enabled.delete(c);
  if(name==='depthMask')return(v:boolean)=>{depthMask=v;};if(name==='activeTexture')return(v:number)=>{active=v;};
  if(name==='bindVertexArray')return(v:any)=>{vao=v;};
  if(name==='bindBuffer'||name==='bindTexture')return(key:number,v:any)=>bindings.set(key,v);
  if(name.startsWith('uniform'))return(u:string,...values:any[])=>{uniforms.set(u,values);};
  if(name==='drawArrays'||name==='drawElements')return(...args:any[])=>{draws.push({args,depthMask,depthTest:enabled.has(2929),sources:current?.sources??[],uniforms:new Map(uniforms)});};
  return()=>{};
 }});return{gl,draws,calls,created,deleted};
}
class MockImage{
 static urls:string[]=[];static instances:MockImage[]=[];
 onload:((...a:any[])=>void)|null=null;onerror:((...a:any[])=>void)|null=null;crossOrigin='';_src='';naturalWidth=512;naturalHeight=512;
 constructor(){MockImage.instances.push(this);}
 set src(v:string){this._src=v;if(v)MockImage.urls.push(v);}get src(){return this._src;}
 succeed(){this.onload?.();}fail(){this.onerror?.();}
}
function makeCanvas(gl:any){return{width:800,height:600,clientWidth:400,clientHeight:300,getContext:()=>gl,addEventListener(){},removeEventListener(){}} as unknown as HTMLCanvasElement;}
const fixtureBody=(id:string,azimuthDeg=0):SkyBody=>{
 const direction=horizontalDirection(azimuthDeg,20);
 return{id,name:id,color:'#e8e3d4',raRad:Math.atan2(direction[2],direction[0]),decRad:20*RAD,azimuthDeg,altitudeDeg:20,apparentAltitudeDeg:refractedAltitude(20),direction,distanceAU:id==='moon'?.00257:.4,angularDiameterRad:(id==='moon'?.5:.015)*RAD,magnitude:id==='moon'?-10:-4,illuminatedFraction:1,sunDirection:direction.map(v=>-v) as Vec3};
};
const fixtureState:SkyState={date:new Date('2026-10-13T14:00:00Z'),location:DEFAULT_LOCATION,equatorialToHorizontal:identity,bodies:[fixtureBody('moon'),fixtureBody('venus',.2)],sunAltitudeDeg:-25,moonPhaseDeg:180};

test('renderer mock: catalog-only requests, DPR<=2, CSS overlays, depth, cached GPU resources, Venus clouds, disposal',async()=>{
 const oldFetch=globalThis.fetch,oldImage=globalThis.Image,oldDpr=globalThis.devicePixelRatio,requests:string[]=[];
 globalThis.Image=MockImage as any;Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:3});MockImage.urls=[];
 globalThis.fetch=async(input:any)=>{requests.push(String(input));const data=await readFile(new URL(`../public/${String(input).replace(/^\.\//,'')}`,import.meta.url));return new Response(data);};
 const{gl,draws,calls,created,deleted}=mockContext(),canvas=makeCanvas(gl),renderer=new SkyRenderer(canvas);
 try{
  await Promise.all([renderer.init(),renderer.init()]);assert.equal(requests.length,5);assert.equal(renderer.getStats().catalogCount,115517);assert.equal(canvas.width,800);assert.equal(canvas.height,600);
  const camera:CameraState={azimuthDeg:0,altitudeDeg:20,fovDeg:1};renderer.render(fixtureState,camera,settings);
  const p=renderer.projectEquatorial(fixtureState.bodies[0].raRad,20*RAD,fixtureState,camera,false);near(p.x,200);near(p.y,150);
  near(renderer.projectHorizontal(0,20,camera).y,150);assert.ok(renderer.projectEquatorial(fixtureState.bodies[0].raRad,20*RAD,fixtureState,camera,true).y<150);
  const resourceCount=calls.length;for(let i=0;i<30;i++)renderer.render(fixtureState,camera,settings);assert.equal(calls.length,resourceCount,'no per-frame createBuffer/texture/program/VAO');
  const bodies=draws.filter(d=>d.sources.some((s:string)=>s.includes('gl_FragDepth=u_depth')));assert.ok(bodies.length>=2);assert.ok(bodies.every(d=>d.depthMask===true&&d.depthTest===true));
  const depths=bodies.slice(0,2).map(d=>d.uniforms.get('u_depth')[0]);assert.ok(depths[0]>depths[1],'far Venus before near Moon, physical depth ordering');
  assert.ok(MockImage.urls.some(url=>url.endsWith('2k_moon.jpg')));assert.ok(!MockImage.urls.some(url=>/venus(?!_atmosphere)/.test(url)),'never request exposed Venus surface texture');assert.ok(!MockImage.urls.some(url=>/\/(4k|8k)_/.test(url)),'first visible frame and immediate rerenders request no HD');assert.ok(renderer.getStats().hipsLoading<=6);
  renderer.dispose();renderer.dispose();assert.equal(deleted.deleteTexture,created.createTexture);assert.equal(deleted.deleteBuffer,created.createBuffer);assert.equal(deleted.deleteVertexArray,created.createVertexArray);
 }finally{renderer.dispose();globalThis.fetch=oldFetch;globalThis.Image=oldImage;Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:oldDpr});}
});

test('missing real catalog level reports partial data without generated replacements; all-failed init rejects',async()=>{
 const oldFetch=globalThis.fetch,oldImage=globalThis.Image;globalThis.Image=MockImage as any;const renderers:SkyRenderer[]=[];
 try{
  globalThis.fetch=async(input:any)=>String(input).includes('lod1')?new Response('',{status:404}):new Response(await readFile(new URL(`../public/${String(input).replace(/^\.\//,'')}`,import.meta.url)));
  const r=new SkyRenderer(makeCanvas(mockContext().gl));renderers.push(r);await r.init();assert.equal(r.getStats().catalogCount,115517-2313);assert.match(r.getStats().status,/失败/);
  globalThis.fetch=async()=>new Response('',{status:404});const failed=new SkyRenderer(makeCanvas(mockContext().gl));renderers.push(failed);await assert.rejects(failed.init(),/没有目录星/);assert.equal(failed.getStats().catalogCount,0);
 }finally{for(const r of renderers)r.dispose();globalThis.fetch=oldFetch;globalThis.Image=oldImage;}
});

test('all-sky renderer sends below-horizon Moon to physical disk pass without ground, extinction or refraction',async()=>{
 const oldFetch=globalThis.fetch,oldImage=globalThis.Image;
 globalThis.Image=MockImage as any;
 globalThis.fetch=async(input:any)=>new Response(await readFile(new URL(`../public/${String(input).replace(/^\.\//,'')}`,import.meta.url)));
 const {gl,draws}=mockContext(),renderer=new SkyRenderer(makeCanvas(gl));
 try{
  await renderer.init();
  const state=computeSky(new Date('2026-10-13T12:50:08Z'),DEFAULT_LOCATION);
  const moon=state.bodies.find(b=>b.id==='moon')!;assert.ok(moon.altitudeDeg<-20);
  const camera={azimuthDeg:moon.azimuthDeg,altitudeDeg:moon.altitudeDeg,fovDeg:3};
  const allsky={...settings,ground:false,atmosphere:false,refraction:false,milkyWay:false,grid:false,constellations:false};
  renderer.render(state,camera,allsky);
  const projected=renderer.projectEquatorial(moon.raRad,moon.decRad,state,camera,false);
  assert.equal(projected.visible,true);near(projected.x,200,1e-5);near(projected.y,150,1e-5);
  const moonDraw=draws.find(d=>d.sources.some((s:string)=>s.includes('gl_FragDepth=u_depth'))&&d.uniforms.get('u_moon')?.[0]===1);
  assert.ok(moonDraw,'negative altitude Moon should still produce a disk draw');
  assert.equal(moonDraw.uniforms.get('u_atmosphere')[0],0);assert.equal(moonDraw.uniforms.get('u_transmission')[0],1);
  assert.ok(!draws.some(d=>d.sources.some((s:string)=>s.includes('u_groundPass'))&&d.uniforms.get('u_groundPass')?.[0]===1),'no ground pass may hide the sky');
  assert.ok(draws.filter(d=>d.sources.some((s:string)=>s.includes('a_star'))).every(d=>d.uniforms.get('u_ground')[0]===0));
 }finally{renderer.dispose();globalThis.fetch=oldFetch;globalThis.Image=oldImage;}
});

for(const outcome of ['recover','exhaust'] as const){
 test(`observer explicitly requires complete remote base and two retries: ${outcome}, truthful status and catalog fallback`,async t=>{
  const oldFetch=globalThis.fetch,oldImage=globalThis.Image,oldDpr=globalThis.devicePixelRatio;
  globalThis.Image=MockImage as any;MockImage.instances=[];MockImage.urls=[];
  Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:2});
  globalThis.fetch=async(input:any)=>new Response(await readFile(new URL(`../public/${String(input).replace(/^\.\//,'')}`,import.meta.url)));
  let now=10000;t.mock.method(Date,'now',()=>now);
  const{gl,draws,created,deleted}=mockContext(),canvas=makeCanvas(gl);
  Object.assign(canvas,{clientWidth:1190,clientHeight:647});
  const renderer=new SkyRenderer(canvas),state={...fixtureState,bodies:[]};
  const allsky={...settings,ground:false,atmosphere:false,refraction:false,constellations:false,grid:false};
  const camera={azimuthDeg:0,altitudeDeg:20,fovDeg:70};
  const hipsDraws=()=>draws.filter(d=>d.sources.some((s:string)=>s.includes('u_texTransform')));
  const render=()=>{draws.length=0;renderer.render(state,camera,allsky);assert.ok(draws.some(d=>d.args[0]===gl.POINTS&&d.args[2]===115517),'real catalog remains drawn');};
  const activeRoot=()=>MockImage.instances.find(image=>image.onload&&/Norder0\/Dir0\/Npix0\.jpg$/.test(image.src))!;
  try{
   await renderer.init();
   assert.match(renderer.getStats().status,/银河底图准备 0\/12/);
   render();assert.equal(hipsDraws().length,0);assert.equal(MockImage.instances.length,6,'shared observer concurrency remains bounded');
   const held=activeRoot();assert.ok(held);
   // Out-of-order completions pump the remaining roots, never any detail.
   for(let frame=0;frame<12;frame++){
    const active=MockImage.instances.filter(image=>image.onload&&image!==held).reverse();
    if(!active.length)break;
    for(const image of active)image.succeed();
    render();assert.equal(hipsDraws().length,0);assert.doesNotMatch(renderer.getStats().status,/完整底图/);
   }
   assert.equal(renderer.getStats().hipsTiles,11);
   assert.match(renderer.getStats().status,/银河底图准备 11\/12/);
   assert.equal(MockImage.instances.length,12);
   assert.ok(MockImage.urls.every(url=>url.startsWith('https://alasky.cds.unistra.fr/MellingerRGB/Norder0/')),'original remote root JPEGs only, no atlas/mirror/legacy fallback');
   held.fail();render();assert.match(renderer.getStats().status,/银河底图准备 11\/12/);
   now+=4999;render();assert.equal(MockImage.instances.length,12);
   now++;render();assert.equal(MockImage.instances.length,13);
   assert.ok(activeRoot(),'first root retry uses same shared queue');activeRoot().fail();
   now+=9999;render();assert.equal(MockImage.instances.length,13);
   now++;render();assert.equal(MockImage.instances.length,14,'observer opts in to two retries, not legacy one');
   const third=activeRoot();assert.ok(third);
   if(outcome==='recover'){
    third.succeed();render();
    assert.ok(hipsDraws().length>0,'all roots enable the galaxy layer on the next frame');
    assert.doesNotMatch(renderer.getStats().status,/银河底图准备|银河底图加载失败/);
    const detail=MockImage.instances.find(image=>image.onload&&/Norder[1-9]\//.test(image.src));
    assert.ok(detail,'fine requests start only once base is complete');detail.fail();render();
    assert.match(renderer.getStats().status,/银河细节失败 \d+（保留完整底图）/);
    assert.ok(hipsDraws().length>0);
    assert.ok(renderer.getStats().hipsTiles>=12);
    allsky.milkyWay=false;render();assert.equal(hipsDraws().length,0);assert.doesNotMatch(renderer.getStats().status,/银河/);
   }else{
    third.fail();render();
    assert.match(renderer.getStats().status,/银河底图加载失败 1\/12（银河层关闭，回退目录星）/);
    assert.doesNotMatch(renderer.getStats().status,/完整底图|银河底图准备/);
    for(let step=0;step<12;step++){
     now+=60000;camera.azimuthDeg=step*51;camera.fovDeg=step%2?110:70;
     Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:step%2?1:2});
     render();assert.equal(hipsDraws().length,0);assert.equal(renderer.getStats().hipsTiles,11);
    }
    assert.equal(MockImage.instances.length,14,'exhaustion does not restart on view/DPR changes');
   }
   renderer.dispose();
   assert.equal(deleted.deleteTexture,created.createTexture);assert.equal(deleted.deleteBuffer,created.createBuffer);assert.equal(deleted.deleteVertexArray,created.createVertexArray);
  }finally{renderer.dispose();globalThis.fetch=oldFetch;globalThis.Image=oldImage;Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:oldDpr});}
 });
}


// Protocol acceptance for the new uniforms, not a rasterization claim. Native
// GLES readback is a separate check; the old u_centerView adapter is retired.
test('circular body uniforms retain true projected centers, CSS optical scale, transported axes and physical radius at every DPR',async()=>{
 const oldFetch=globalThis.fetch,oldImage=globalThis.Image,oldDpr=globalThis.devicePixelRatio;
 globalThis.Image=MockImage as any;
 globalThis.fetch=async(input:any)=>new Response(await readFile(new URL(`../public/${String(input).replace(/^\.\//,'')}`,import.meta.url)));
 const {gl,draws}=mockContext(),canvas=makeCanvas(gl),renderer=new SkyRenderer(canvas);
 const allsky={...settings,ground:false,atmosphere:false,refraction:false,milkyWay:false,grid:false,constellations:false};
 const positions=[[0,0],[-.75,0],[.75,0],[0,-.75],[0,.75],[-.75,-.75],[-.75,.75],[.75,-.75],[.75,.75]];
 try{
  await renderer.init();
  for(const [w,h]of [[1440,900],[390,844],[844,390]])for(const dpr of [1,1.5,2,3])for(const fovDeg of [70,110,.0001])for(const [nx,ny]of positions){
   Object.assign(canvas,{clientWidth:w,clientHeight:h});Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:dpr});
   const camera={azimuthDeg:123,altitudeDeg:23,fovDeg},basis=cameraBasis(camera),t=Math.tan(fovDeg*RAD/2);
   const v=basis.forward.map((x,i)=>x+basis.right[i]*nx*t*w/h+basis.up[i]*ny*t) as Vec3;
   const direction=v.map(x=>x/Math.hypot(...v)) as Vec3;
   const body={...fixtureBody('sun'),direction,angularDiameterRad:Math.min(.534*RAD,fovDeg*RAD*.18)};
   const state={...fixtureState,bodies:[body]},before=JSON.stringify(state);
   draws.length=0;renderer.render(state,camera,allsky);
   const disk=draws.filter(d=>d.sources.some((s:string)=>s.includes('gl_FragDepth=u_depth')));assert.equal(disk.length,1);
   const u=disk[0].uniforms,p=projectDirection(direction,camera,w,h);
   assert.equal(u.has('u_centerView'),false,'do not accidentally keep using the old off-axis sphere uniform');
   near((u.get('u_centerNdc')[0]+1)*w/2,p.x,1e-6);near((1-u.get('u_centerNdc')[1])*h/2,p.y,1e-6);
   near(u.get('u_tanFov')[0],t*w/h);near(u.get('u_tanFov')[1],t);
   const r=u.get('u_radius')[0],radiusPx=h*r/Math.sqrt(1-r*r)/(2*t);
   near(r,Math.sin(body.angularDiameterRad/2));near(radiusPx,angularDiameterCssPixels(body.angularDiameterRad,fovDeg,h)/2,1e-7);
   const right=u.get('u_bodyRight'),up=u.get('u_bodyUp'),forward=u.get('u_bodyForward');
   nearVec(forward,direction);near(Math.hypot(...right),1);near(Math.hypot(...up),1);
   near(right.reduce((s:number,x:number,i:number)=>s+x*up[i],0),0);
   near(right.reduce((s:number,x:number,i:number)=>s+x*direction[i],0),0);
   near(up.reduce((s:number,x:number,i:number)=>s+x*direction[i],0),0);
   assert.ok(disk[0].depthMask&&disk[0].depthTest);assert.equal(JSON.stringify(state),before);
   assert.equal(canvas.width,Math.round(w*Math.min(2,dpr)));assert.equal(canvas.height,Math.round(h*Math.min(2,dpr)));
  }
 }finally{renderer.dispose();globalThis.fetch=oldFetch;globalThis.Image=oldImage;Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:oldDpr});}
});

test('renderer culls new circular corners and camera plane, but submits a partly visible limb',async()=>{
 const oldFetch=globalThis.fetch,oldImage=globalThis.Image;globalThis.Image=MockImage as any;
 globalThis.fetch=async(input:any)=>new Response(await readFile(new URL(`../public/${String(input).replace(/^\.\//,'')}`,import.meta.url)));
 const {gl,draws}=mockContext(),canvas=makeCanvas(gl);Object.assign(canvas,{clientWidth:1200,clientHeight:800});
 const renderer=new SkyRenderer(canvas),camera={azimuthDeg:0,altitudeDeg:0,fovDeg:70};
 const allsky={...settings,ground:false,atmosphere:false,refraction:false,milkyWay:false,grid:false,constellations:false};
 const t=Math.tan(35*RAD),diameter=2*Math.atan(80*t/800),ray=(x:number,y:number):Vec3=>{const p:Vec3=[(2*x/1200-1)*t*1.5,(1-2*y/800)*t,-1];return p.map(v=>v/Math.hypot(...p)) as Vec3;};
 try{
  await renderer.init();
  for(const [direction,visible]of [[ray(-20,400),true],[ray(-20,-20),true],[ray(-30,-30),false],[[1,0,0],false],[[0,0,1],false]] as [Vec3,boolean][]){
   draws.length=0;renderer.render({...fixtureState,bodies:[{...fixtureBody('sun'),direction,angularDiameterRad:diameter}]},camera,allsky);
   const disks=draws.filter(d=>d.sources.some((s:string)=>s.includes('gl_FragDepth=u_depth')));
   assert.equal(disks.length,visible?1:0);
   if(visible)assert.ok(disks[0].uniforms.get('u_rect').every((n:number)=>Number.isFinite(n)&&n>=-1&&n<=1));
  }
 }finally{renderer.dispose();globalThis.fetch=oldFetch;globalThis.Image=oldImage;}
});
