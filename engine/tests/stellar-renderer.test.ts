import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SpaceRenderer } from '../src/space/renderer';
import { StellarFramePlanner, STELLAR_RESOLVED_DIAMETER, MAX_STELLAR_SPHERES } from '../src/space/stellar-render';
import { STELLAR_SURFACE_FRAG } from '../src/space/stellar-shaders';
import { getStellarModel, stellarBody } from '../src/space/stellar-model';
import { bodyFrame, bodyHitDistance, projectSpace, relativePosition } from '../src/space/render-math';
import { computeSpace } from '../src/space/world';
import { AU_KM, PARSEC_AU, type CatalogStar3D, type SpaceBody, type SpaceCamera, type SpaceView, type Vec3 } from '../src/space/types';
import { recordingCanvas } from './space-renderer-harness';

const catalog:CatalogStar3D[]=JSON.parse(fs.readFileSync(new URL('../public/data/space-stars.json',import.meta.url),'utf8')).stars;
const find=(name:string)=>catalog.find(s=>s.id===name||s.name.toLowerCase()===name.toLowerCase())!;
const scheat=find('hyg-113521');
// Synthetic geometry fixtures preserve real HYG identity/photometry and a
// self-consistent heliocentric distance. They are not new production star data.
const moved=(star:CatalogStar3D,positionAU:Vec3):CatalogStar3D=>({...star,positionAU,distancePc:Math.hypot(...positionAU)/PARSEC_AU});
const near=(a:number,b:number,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const view=(camera:SpaceCamera,selectedId:string|null=scheat.id):SpaceView=>({camera,selectedId,mode:'orbit',speedAUPerSecond:.1});
const options={labels:true,orbits:false,photographicBackground:false,cinematic:true};
const empty={date:new Date('2026-10-14T15:00:00Z'),bodies:[] as SpaceBody[]};
const camera=(positionAU:Vec3=[0,0,0],azimuthDeg=0,altitudeDeg=0,rollDeg=0):SpaceCamera=>({positionAU,azimuthDeg,altitudeDeg,rollDeg,fovDeg:60});
function close(star:CatalogStar3D,multiple=4.5,theta=0,roll=0):SpaceCamera {
  const r=getStellarModel(star)!.radiusKm/AU_KM,d=r*multiple;
  const position:Vec3=[star.positionAU[0]+Math.sin(theta)*d,star.positionAU[1],star.positionAU[2]+Math.cos(theta)*d];
  const direction=relativePosition(star.positionAU,position)!.direction;
  return camera(position,Math.atan2(direction[0],-direction[2])*180/Math.PI,Math.asin(direction[1])*180/Math.PI,roll);
}
async function fixture(t:any,stars:CatalogStar3D[]=[scheat],width=960,height=640,wrap?:(gl:any)=>any){
  const r=recordingCanvas(width,height),old=globalThis.Image;globalThis.Image=r.FakeImage as any;
  if(wrap){const gl=wrap(r.gl);r.canvas.getContext=()=>gl;}
  const renderer=new SpaceRenderer(r.canvas);await renderer.init(stars);
  t.after(()=>{renderer.dispose();globalThis.Image=old;});return {...r,renderer};
}
const surfaceDraws=(draws:any[])=>draws.filter(d=>d.shaders.includes(STELLAR_SURFACE_FRAG));
const pointCount=(draws:any[])=>draws.filter(d=>d.args[0]===0&&d.uniforms.u_locator?.[0]===0).reduce((n,d)=>n+d.args[2],0);

test('Scheat/Sirius/Proxima/Vega real model radii become finite globes, grow at fixed FOV and AU distance',()=>{
  for(const star of [scheat,find('Sirius'),find('Proxima Centauri'),find('Vega')]){
    assert.ok(star);const model=getStellarModel(star)!;assert.ok(model);const b=stellarBody(star)!;
    const p=new StellarFramePlanner([star]),far=close(star,9),nearby=close(star,4.5);
    const a=p.plan(far,960,640,star.id)[0],z=p.plan(nearby,960,640,star.id)[0];
    assert.ok(a&&z,star.name);assert.ok(z.radiusCssPixels>a.radiusCssPixels*2);near(nearby.fovDeg,far.fovDeg);
    near(z.radiusAU,model.radiusKm/AU_KM,1e-15);near(z.radiusCssPixels,bodyFrame(b,[0,0,0],nearby,960,640)!.radiusCssPixels);
    near(z.distanceAU/a.distanceAU,.5,1e-5);assert.ok(z.radiusCssPixels>100);
    assert.equal(b.textureId,'');p.dispose();assert.deepEqual(p.plan(nearby,960,640,star.id),[]);
  }
});

test('stellar circular surface picking, off-axis/roll/inverted/partial viewport and behind-camera culling agree',()=>{
  const star=moved(scheat,[0,0,-1]),r=getStellarModel(star)!.radiusKm/AU_KM;
  for(const roll of [0,45,90,180,360])for(const alt of [0,180,360]){
    const c=camera([0,0,-1+r*4.5],alt===180?180:0,alt,roll),p=new StellarFramePlanner([star]),f=p.plan(c,960,640,star.id)[0];assert.ok(f);
    near(f.centerNdc[0],0);near(f.centerNdc[1],0);near(bodyHitDistance(f,480,320,960,640,c)!,f.distanceAU-f.radiusAU);
    assert.ok(bodyHitDistance(f,480+f.radiusCssPixels*.995,320,960,640,c)!>0);
    assert.equal(bodyHitDistance(f,480+f.radiusCssPixels*1.01,320,960,640,c),null);
    const off={...c,azimuthDeg:c.azimuthDeg+36},frame=p.plan(off,960,640,star.id)[0];assert.ok(frame);assert.ok(frame.centerNdc.some(x=>Math.abs(x)>.7));
    assert.equal(p.plan({...c,azimuthDeg:c.azimuthDeg+180},960,640,star.id).length,0);
  }
  // Shift the star's center outside the viewport but preserve a visible physical limb.
  const c=close(star,4.5);c.azimuthDeg=34;const f=new StellarFramePlanner([star]).plan(c,640,640,star.id)[0];
  assert.ok(f);assert.ok(Math.abs(f.centerNdc[0])>1);assert.ok(f.rect[0]<f.rect[2]);
});

test('planner prepares once, uses spatial rejection at Earth and cache invalidates size/selection/orientation/roll',()=>{
  const p=new StellarFramePlanner(catalog),c=camera();assert.ok(p.stats.prepared>0);
  assert.equal(p.plan(c,960,640,null).length,0);assert.ok(p.stats.testedStars<catalog.length/10,'radius index prunes the distant catalog');
  const rebuilt=p.stats.rebuilds;p.plan(c,960,640,null);assert.equal(p.stats.rebuilds,rebuilt);
  for(const [camera,width,height,id] of [[c,960,640,scheat.id],[c,1920,640,scheat.id],[c,1920,1200,scheat.id],[{...c,rollDeg:20},1920,1200,scheat.id],[{...c,azimuthDeg:30},1920,1200,scheat.id]] as [SpaceCamera,number,number,string][])
    p.plan(camera,width,height,id);
  assert.equal(p.stats.rebuilds,rebuilt+5);p.dispose();
});

test('sphere hard budget retains selected and overflow as points; exact-position duplicate selection deterministic',async t=>{
  const source=find('Sirius'),r=getStellarModel(source)!.radiusKm/AU_KM;
  const stars=catalog.slice(0,40).map((s,i)=>{const radius=getStellarModel(s)!.radiusKm/AU_KM;return moved(s,[(i-20)*radius*.008,0,-radius*8]);});
  const f=await fixture(t,stars),c=camera(),v=view(c,stars.at(-1)!.id);f.renderer.render(empty,v,options,0);
  assert.equal(surfaceDraws(f.draws).length,MAX_STELLAR_SPHERES);assert.equal(pointCount(f.draws),stars.length-MAX_STELLAR_SPHERES);
  assert.ok(f.renderer.getStellarFrames().some(x=>x.star.id===v.selectedId));
  const formerlyPoint=stars.find(s=>!f.renderer.getStellarFrames().some(x=>x.star.id===s.id))!,at=f.draws.length;
  f.renderer.render(empty,view(c,formerlyPoint.id),options,16);
  assert.ok(f.renderer.getStellarFrames().some(x=>x.star.id===formerlyPoint.id));
  assert.equal(surfaceDraws(f.draws.slice(at)).length,MAX_STELLAR_SPHERES);assert.equal(pointCount(f.draws.slice(at)),stars.length-MAX_STELLAR_SPHERES);
  const dups=[moved(source,[0,0,-r*5]),moved(find('Vega'),[0,0,-r*5])],first=[...dups].sort((a,b)=>a.id.localeCompare(b.id))[0].id,selected=dups[1].id;
  const p=new StellarFramePlanner(dups);assert.equal(p.plan(c,960,640,null)[0].star.id,first);
  assert.equal(p.plan(c,960,640,selected)[0].star.id,selected);assert.equal(p.plan(c,960,640,selected).length,1);
  assert.deepEqual(new Set(p.plan(c,960,640,null)[0].pointIds),new Set(dups.map(s=>s.id)));
});

test('same-position stars have one sphere, no duplicate core, preferred selected and no invented separation',async t=>{
  const source=find('Sirius'),r=getStellarModel(source)!.radiusKm/AU_KM;
  const stars=[source,find('Vega')].map(s=>moved(s,[0,0,-r*5])),f=await fixture(t,stars),c=camera();
  f.renderer.render(empty,view(c,stars[0].id),options,0);assert.equal(surfaceDraws(f.draws).length,1);assert.equal(pointCount(f.draws),0);
  assert.equal(f.renderer.pick(480,320,empty,view(c,stars[0].id)),stars[0].id);assert.equal(f.renderer.pick(480,320,empty,view(c,stars[1].id)),stars[1].id);
  assert.deepEqual(stars[0].positionAU,stars[1].positionAU);
});

test('stellar surface is wholly self-emitting and all material uniforms stable with clock/Sun changes',async t=>{
  const f=await fixture(t),c=close(scheat);f.renderer.render(empty,view(c),options,10);const a=surfaceDraws(f.draws).at(-1);
  assert.ok(a);assert.equal(a.uniforms.u_surfaceMix[0],1);assert.ok(a.depth&&a.depthWrite);assert.equal(pointCount(f.draws),0);
  const fakeSun:SpaceBody={...stellarBody(scheat)!,id:'sun',positionAU:[100,0,100],textureId:'sun'};
  f.renderer.render({...empty,date:new Date('2040-01-01'),bodies:[fakeSun]},view(c),options,1e7);const b=surfaceDraws(f.draws).at(-1);
  assert.deepEqual(a.uniforms,b.uniforms);assert.equal(a.uniforms.u_light,undefined);assert.equal(a.uniforms.u_sun,undefined);
  assert.equal(a.uniforms.u_time,undefined);assert.equal(a.uniforms.u_hasTexture,undefined);
  assert.match(STELLAR_SURFACE_FRAG,/float mu=clamp\(root\/u_radius/);
  assert.doesNotMatch(STELLAR_SURFACE_FRAG,/uniform.*(?:sampler|u_light|u_time|u_sun|u_seed|u_temperature|u_axis)|atan\(|noise|granul|hash3|filteredNoise/);
});

test('approximate color variety uses one smooth shader and allocates no textures/per-star GPU objects',async t=>{
  const stars=[scheat,find('Sirius'),find('Proxima Centauri'),find('Vega')],f=await fixture(t,stars);
  const before=f.calls.filter(c=>c.method==='shaderSource').length,colors=new Set<string>();
  for(const star of stars){f.renderer.render(empty,view(close(star),star.id),options,100);const draw=surfaceDraws(f.draws).at(-1);assert.ok(draw);colors.add(draw.uniforms.u_color.join(','));assert.equal(draw.uniforms.u_temperature,undefined);assert.equal(draw.uniforms.u_seed,undefined);}
  assert.ok(colors.size>=3);assert.equal(f.calls.filter(c=>c.method==='shaderSource').length,before+2);
  assert.equal(f.images.length,0);assert.equal(f.renderer.getStats().textures!.uploads,0);assert.equal(f.renderer.getStats().textures!.gpuBytes,0);
  assert.equal(f.calls.filter(c=>c.method==='texImage2D').length,1,'only pre-existing 1px Solar fallback');
});

test('natural 10–20px transition suppresses old point only with matching sphere and drops false 10px hit fallback',async t=>{
  const star=moved(find('Sirius'),[0,0,-1]),f=await fixture(t,[star]),r=getStellarModel(star)!.radiusKm/AU_KM;
  const atDiameter=(diameter:number)=>camera([0,0,-1+r*Math.hypot(1,640/(diameter*Math.tan(Math.PI/6)))]);
  for(const diameter of [9.9,10.1,15,20.1,60]){
    const c=atDiameter(diameter),at=f.draws.length;f.renderer.render(empty,view(c,star.id),options,diameter);
    const draws=f.draws.slice(at),surface=surfaceDraws(draws);
    assert.equal(surface.length,diameter>=STELLAR_RESOLVED_DIAMETER?1:0);assert.equal(pointCount(draws),surface.length?0:1);
    if(surface.length){near(surface[0].uniforms.u_diameter[0],diameter);assert.equal(f.renderer.pick(480+diameter/2+1,320,empty,view(c,star.id)),null);}
    if(diameter===15)near(surface[0].uniforms.u_surfaceMix[0],.5);
  }
});

test('stationary camera resize toggles threshold; orientation reveals old point again with cache invalidation',async t=>{
  const star=moved(find('Sirius'),[0,0,-1]),f=await fixture(t,[star],960,640),r=getStellarModel(star)!.radiusKm/AU_KM;
  const c=camera([0,0,-1+r*Math.hypot(1,640/(8*Math.tan(Math.PI/6)))]);
  f.renderer.render(empty,view(c,star.id),options,0);assert.equal(f.renderer.getStats().drawnStars,1);assert.equal(f.renderer.getStats().resolvedStars,0);
  f.canvas.clientHeight=1280;f.renderer.render(empty,view(c,star.id),options,16);
  assert.equal(f.renderer.getStats().drawnStars,0);assert.equal(f.renderer.getStats().resolvedStars,1);
  const frames=f.renderer.getStellarFrames();assert.equal(frames,f.renderer.getStellarFrames());
  f.renderer.render(empty,view({...c,azimuthDeg:180},star.id),options,32);
  assert.equal(f.renderer.getStats().drawnStars,1);assert.equal(f.renderer.getStats().resolvedStars,0);assert.equal(f.renderer.getStellarFrames().length,0);
});

test('large stellar disk wins full-disk clicks, Solar foreground wins nearest surface and no old point outside disk',async t=>{
  const star=moved(find('Sirius'),[0,0,-1]),f=await fixture(t,[star]),c=close(star),s=stellarBody(star)!;
  f.renderer.render(empty,view(c,star.id),options,0);const frame=f.renderer.getStellarFrames()[0];
  assert.equal(f.renderer.pick(480+frame.radiusCssPixels*.8,320,empty,view(c,star.id)),star.id);
  assert.equal(f.renderer.pick(480+frame.radiusCssPixels+1,320,empty,view(c,star.id)),null);
  const foreground:SpaceBody={...s,id:'earth',kind:'planet',radiusKm:s.radiusKm*.1,positionAU:[0,0,(-1+c.positionAU[2])*.5],textureId:'earth'};
  const world={...empty,bodies:[foreground]};f.renderer.render(world,view(c,star.id),options,16);
  assert.equal(f.renderer.pick(480,320,world,view(c,star.id)),'earth');
  const surface=f.draws.filter(d=>d.uniforms.u_radius).slice(-2);assert.ok(surface[0].uniforms.u_logDistance[0]>surface[1].uniforms.u_logDistance[0]);
  const behind={...foreground,positionAU:[0,0,-2-c.positionAU[2]] as Vec3};assert.equal(f.renderer.pick(480,320,{...empty,bodies:[behind]},view(c,star.id)),star.id);
});

test('default Earth camera produces no resolved stars and no stellar shader/context/texture requests',async t=>{
  const f=await fixture(t,catalog),world=computeSpace(empty.date),earth=world.bodies.find(b=>b.id==='earth')!,radius=earth.radiusKm/AU_KM;
  const before=f.calls.filter(c=>c.method==='shaderSource').length,c=camera([earth.positionAU[0],earth.positionAU[1],earth.positionAU[2]+4.5*radius]);
  f.renderer.render(world,view(c,'earth'),options,0);assert.equal(f.renderer.getStats().resolvedStars,0);
  assert.equal(f.calls.filter(c=>c.method==='shaderSource').length,before);assert.ok(f.images.every(i=>!i.src.includes('stellar')));
});

test('shader compile failure falls back to points, deletes partial shaders and never retries each RAF',async t=>{
  let fail=false;const f=await fixture(t,[scheat],960,640,base=>new Proxy(base,{get(target,key){if(key==='getShaderParameter')return()=>!fail;return target[key];}}));
  fail=true;const c=close(scheat),n=f.calls.filter(c=>c.method==='deleteShader').length;
  f.renderer.render(empty,view(c),options,0);assert.equal(f.renderer.getStellarFrames().length,0);assert.equal(f.renderer.getStats().drawnStars,1);
  assert.match(f.renderer.getStats().status,/保留目录光点/);assert.ok(f.calls.filter(c=>c.method==='deleteShader').length>n);
  const compiled=f.calls.filter(c=>c.method==='compileShader').length;f.renderer.render(empty,view(c),options,16);assert.equal(f.calls.filter(c=>c.method==='compileShader').length,compiled);
});

test('initial point buffer allocation failure cleans partial VAO/program resources',async t=>{
  const r=recordingCanvas(),old=globalThis.Image;globalThis.Image=r.FakeImage as any;t.after(()=>{globalThis.Image=old;});
  const base=r.gl;r.canvas.getContext=()=>new Proxy(base,{get(target,key){if(key==='createBuffer')return()=>null;return target[key];}});
  const renderer=new SpaceRenderer(r.canvas);await assert.rejects(()=>renderer.init([scheat]),/Point mesh allocation failed/);
  assert.equal(r.calls.filter(c=>c.method==='deleteVertexArray').length,2,'quad plus incomplete point VAO');
  assert.equal(r.calls.filter(c=>c.method==='deleteProgram').length,2);assert.equal(r.listeners.size,0);
  assert.deepEqual(renderer.getStellarFrames(),[]);renderer.dispose();
});

test('generic HIP models resolve but unknown/photometry-mismatched records remain selectable points without false radius',async t=>{
  const hip=catalog.find(s=>/^HIP /.test(s.name)&&getStellarModel(s))!;assert.ok(hip);
  const unknown={...scheat,id:'unsupported-record',sourceId:'unsupported-record'},mismatch={...find('Sirius'),absoluteMagnitude:99};
  assert.equal(getStellarModel(unknown),null);assert.equal(getStellarModel(mismatch),null);
  const f=await fixture(t,[hip,unknown,mismatch]);f.renderer.render(empty,view(close(hip),hip.id),options,0);
  assert.equal(f.renderer.getStellarFrames()[0].star.id,hip.id);
  f.renderer.render(empty,view(close(scheat),unknown.id),options,16);assert.equal(f.renderer.getStellarFrames().length,0);
  assert.equal(f.renderer.pick(480,320,empty,view(close(scheat),unknown.id)),unknown.id);
  assert.equal(f.renderer.getStats().drawnStars,3);
});

test('dispose/context loss clears current surfaces and no late work recreates rendering',async t=>{
  const f=await fixture(t),c=close(scheat);assert.deepEqual(f.renderer.getStellarFrames(),[]);
  f.renderer.render(empty,view(c),options,0);assert.equal(f.renderer.getStellarFrames().length,1);const count=f.draws.length;
  f.listeners.get('webglcontextlost')!({preventDefault(){}});assert.deepEqual(f.renderer.getStellarFrames(),[]);
  f.renderer.render(empty,view(c),options,16);assert.equal(f.draws.length,count);
  f.renderer.dispose();f.renderer.dispose();assert.equal(f.listeners.size,0);assert.deepEqual(f.renderer.getStellarFrames(),[]);
  assert.ok(f.calls.filter(c=>c.method==='deleteProgram').length>=4);assert.equal(f.renderer.getStats().textures!.disposed,true);
});
