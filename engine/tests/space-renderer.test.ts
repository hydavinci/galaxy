import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyFrame, bodyHitDistance, dot, illuminatedFraction, logarithmicDepth, photographicBackgroundWeight, projectSpace, relativePosition, spaceCameraBasis, starMagnitude, textureCamera } from '../src/space/render-math';
import { SpaceRenderer } from '../src/space/renderer';
import { SPACE_BODY_FRAG, SPACE_STAR_VERT } from '../src/space/shaders';
import { computeSpace } from '../src/space/world';
import { AU_KM, PARSEC_AU, type CatalogStar3D, type SpaceBody, type SpaceCamera, type SpaceRenderOptions, type SpaceView, type Vec3 } from '../src/space/types';
import { recordingCanvas } from './space-renderer-harness';

const near=(a:number,b:number,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} ≠ ${b}`);
const vectorNear=(a:Vec3,b:Vec3,t=1e-9)=>a.forEach((x,i)=>near(x,b[i],t));
const cam=(positionAU:Vec3=[0,0,0],azimuthDeg=0,altitudeDeg=0,fovDeg=60):SpaceCamera=>({positionAU,azimuthDeg,altitudeDeg,fovDeg});
const body=(id='earth',positionAU:Vec3=[0,0,-.001],radiusKm=6378.137):SpaceBody=>({id,positionAU,radiusKm,name:id,nameEn:id,kind:'planet',color:'#90b6ff',textureId:id,axisNorth:[0,1,0],axisPrime:[1,0,0],axisEast:[0,0,1]});
const star=(positionAU:Vec3=[0,0,-PARSEC_AU],id='catalog-real'):CatalogStar3D=>({id,name:id,positionAU,absoluteMagnitude:5,bv:.6,distancePc:Math.hypot(...positionAU)/PARSEC_AU,sourceId:'test-observed-parallax'});
const options:SpaceRenderOptions={labels:true,orbits:false,photographicBackground:false,cinematic:true};
const view=(camera=cam()):SpaceView=>({camera,mode:'free',selectedId:'earth',speedAUPerSecond:.01});
const snapshot=(bodies:SpaceBody[])=>({date:new Date('2026-10-14T04:00:00Z'),bodies});
function look(position:Vec3,target:Vec3):SpaceCamera {const d=relativePosition(target,position)!.direction;return cam(position,Math.atan2(d[0],-d[2])*180/Math.PI,Math.asin(d[1])*180/Math.PI);}

// Numerics / GL protocol only. Dedicated native fixtures are a separate evidence layer.
test('floating origin subtracts doubles before float32, near Earth / Neptune / catalog origins',()=>{
  for(const origin of [0,1,30,1e7,1e8]){
    const c:Vec3=[origin,origin,-origin],p:Vec3=[origin+.0001,origin-.00003,-origin-.0002];
    const r=relativePosition(p,c)!;
    assert.ok(r.distanceAU>0&&r.distanceAU<.001);near(Math.hypot(...r.direction),1);
    if(origin>=1e7){assert.deepEqual(Array.from(new Float32Array(p)),Array.from(new Float32Array(c)));assert.ok(r.vector.some(x=>x!==0));}
    const f=bodyFrame(body('earth',p),[0,0,0],look(c,p),900,600)!;
    assert.ok(f);near(f.centerNdc[0],0,1e-9);near(f.centerNdc[1],0,1e-9);near(f.radius* r.distanceAU,6378.137/AU_KM,1e-15);
  }
});
test('orientation is inertial and whole sphere has no geographic ground mask',()=>{
  for(const az of [0,90,180,270,359])for(const alt of [-89,-60,0,60,89]){
    const camera=cam([4,2,1],az,alt),basis=spaceCameraBasis(camera);
    near(Math.hypot(...basis.right),1);near(Math.hypot(...basis.up),1);near(dot(basis.right,basis.up),0);near(dot(basis.up,basis.forward),0);
    const target=camera.positionAU.map((v,i)=>v+basis.forward[i]) as Vec3,p=projectSpace(target,camera,960,640);
    near(p.x,480);near(p.y,320);assert.ok(p.visible);
  }
});
test('real dolly changes angular diameter at unchanged field of view',()=>{
  const b=body(),a=bodyFrame(b,[0,0,-1],cam(),1000,700)!,c=bodyFrame(b,[0,0,-1],cam([0,0,-.0005]),1000,700)!;
  assert.ok(c.radiusCssPixels>a.radiusCssPixels*1.99);near(c.distanceAU,a.distanceAU/2);near(c.radius,2*a.radius);
  const expected=700*(c.radius/Math.sqrt(1-c.radius*c.radius))/(2*Math.tan(Math.PI/6));near(c.radiusCssPixels,expected);
});
test('translation changes true finite Earth–Moon directions and finite catalog parallax',()=>{
  const state=computeSpace(new Date('2026-10-14T04:00:00Z')),earth=state.bodies.find(b=>b.id==='earth')!,moon=state.bodies.find(b=>b.id==='moon')!;
  const a=earth.positionAU.map((v,i)=>v+[0,0,.001][i]) as Vec3,b=moon.positionAU.map((v,i)=>v+[0,0,.001][i]) as Vec3;
  const ea=relativePosition(earth.positionAU,a)!,ma=relativePosition(moon.positionAU,a)!,eb=relativePosition(earth.positionAU,b)!,mb=relativePosition(moon.positionAU,b)!;
  assert.ok(Math.abs(dot(ea.direction,ma.direction)-dot(eb.direction,mb.direction))>.05);
  const s=star(),p0=projectSpace(s.positionAU,cam(),800,600),p1=projectSpace(s.positionAU,cam([1000,0,0]),800,600);assert.ok(Math.abs(p0.x-p1.x)>2);
});
test('physical Sun lighting produces observer-dependent day, quarter, night on same Earth',()=>{
  const b=body('earth',[1,0,0]);
  for(const [position,phase] of [[[.9998,0,0],1],[[1,.0002,0],.5],[[1.0002,0,0],0]] as [Vec3,number][]){
    const f=bodyFrame(b,[0,0,0],look(position,b.positionAU),900,600)!;
    near(illuminatedFraction(f),phase);vectorNear(f.light,[-1,0,0]);
  }
});
test('ten true bodies coexist and every body supports arbitrary external viewpoints',()=>{
  const world=computeSpace(new Date('2026-10-14T04:00:00Z'));assert.equal(world.bodies.length,10);
  for(const b of world.bodies){
    const radius=b.radiusKm/AU_KM,camera=look([b.positionAU[0],b.positionAU[1],b.positionAU[2]+radius*5],b.positionAU);
    const f=bodyFrame(b,[0,0,0],camera,960,640,true)!;assert.ok(f,b.id);near(f.radius,.2,1e-10);assert.ok(f.radiusCssPixels>100);assert.ok(f.rect.every(Number.isFinite));
  }
});
test('culling rejects behind camera, nonfinite and collision; retains visible off-screen limb',()=>{
  assert.equal(bodyFrame(body('earth',[0,0,1]),[0,0,0],cam(),800,600),null);
  assert.equal(bodyFrame(body('earth',[1,0,0]),[0,0,0],cam(),800,600),null);
  assert.equal(bodyFrame(body('earth',[0,0,0]),[0,0,0],cam(),800,600),null);
  assert.equal(bodyFrame(body('earth',[0,0,-1e-8]),[0,0,0],cam(),800,600),null);
  assert.equal(bodyFrame(body('earth',[NaN,0,-1]),[0,0,0],cam(),800,600),null);
  assert.equal(bodyFrame({...body(),axisNorth:[NaN,0,0]},[0,0,0],cam(),800,600),null);
  const c=cam(),b=body('earth',[.00079,0,-.001],15000),f=bodyFrame(b,[0,0,-1],c,800,600)!;assert.ok(f);assert.ok(f.centerNdc[0]>1);assert.ok(f.rect[0]<1);
  for(const p of [[0,0,0],[0,0,1],[1,0,0],[NaN,0,0]] as Vec3[]){const result=projectSpace(p,c,800,600);assert.equal(result.visible,false);assert.ok(Number.isFinite(result.x+result.y));}
});
test('resolved picking follows circular display limb and nearest physical surface, not inflated Earth radius',()=>{
  const b=body(),c=cam(),f=bodyFrame(b,[0,0,-1],c,800,600)!,r=f.radiusCssPixels;
  near(bodyHitDistance(f,400,300,800,600,c)!,f.distanceAU-f.radiusAU);
  assert.ok(bodyHitDistance(f,400+r*.999,300,800,600,c)!>0);
  assert.equal(bodyHitDistance(f,400+r*1.01,300,800,600,c),null);
  assert.equal(bodyHitDistance(f,-1,300,800,600,c),null);
});
test('magnitude changes with actual observer distance, no fixed Earth magnitude',()=>{
  const s=star();near(starMagnitude(s,10*PARSEC_AU),5);near(starMagnitude(s,PARSEC_AU),0);near(starMagnitude(s,100*PARSEC_AU),10);
  assert.ok(logarithmicDepth(.0001)<logarithmicDepth(1));assert.ok(logarithmicDepth(1)<logarithmicDepth(PARSEC_AU));
});
test('photographic far-sky is faded and disabled before interstellar catalog boundary',()=>{
  near(photographicBackgroundWeight([0,0,0]),1);near(photographicBackgroundWeight([100,0,0]),1);
  assert.ok(photographicBackgroundWeight([.2*PARSEC_AU,0,0])<1);near(photographicBackgroundWeight([.5*PARSEC_AU,0,0]),0);near(photographicBackgroundWeight([1e8,0,0]),0);
});
test('texture stability uses body-relative image pose, retaining translation and orbit distinction',()=>{
  const b=body(),c=cam(),f=bodyFrame(b,[0,0,-1],c,960,640)!;
  const translate:Vec3=[2,3,4],moved={...b,positionAU:b.positionAU.map((x,i)=>x+translate[i]) as Vec3},mc=cam(translate);
  const mf=bodyFrame(moved,[0,0,-1],mc,960,640)!;
  const a=textureCamera(f,c),z=textureCamera(mf,mc);near(a.azimuthDeg,z.azimuthDeg);near(a.altitudeDeg,z.altitudeDeg);near(a.fovDeg,z.fovDeg);
  const orbit=look([.001,0,-.001],b.positionAU),of=bodyFrame(b,[0,0,-1],orbit,960,640)!;assert.ok(Math.abs(textureCamera(of,orbit).azimuthDeg-a.azimuthDeg)>80);
});
test('space shader has physical log ray-hit depth, wrapped UV derivatives, bounded cinematic shell, no ground uniforms',()=>{
  assert.match(SPACE_BODY_FRAG,/u_logDistance\+log2/);assert.match(SPACE_BODY_FRAG,/hitDistance=rayLocal.z-root/);assert.match(SPACE_BODY_FRAG,/dot\(n,light\)/);
  assert.match(SPACE_BODY_FRAG,/textureGrad/);assert.match(SPACE_BODY_FRAG,/dx.x-=round\(dx.x\)/);assert.match(SPACE_BODY_FRAG,/if\(opacity<=.001\)discard/);
  assert.doesNotMatch(SPACE_BODY_FRAG,/u_ground|u_equatorialToHorizontal|u_normalToGeometric|SkyState/);assert.match(SPACE_STAR_VERT,/a_direction/);assert.doesNotMatch(SPACE_STAR_VERT,/u_cameraPosition|a_positionAU/);
});

async function fixture(t:any,width=960,height=640,catalog:CatalogStar3D[]=[star()]){
  const rec=recordingCanvas(width,height),old=globalThis.Image;globalThis.Image=rec.FakeImage as any;t.after(()=>{globalThis.Image=old;});
  const renderer=new SpaceRenderer(rec.canvas);await renderer.init(catalog);t.after(()=>renderer.dispose());return {...rec,renderer};
}
test('renderer API submits all ten finite bodies through the SAME canvas across viewpoints',async t=>{
  const f=await fixture(t),world=computeSpace(new Date('2026-10-14T04:00:00Z'));
  for(const b of world.bodies){const radius=b.radiusKm/AU_KM,c=look([b.positionAU[0],b.positionAU[1],b.positionAU[2]+radius*5],b.positionAU),n=f.draws.length;
    f.renderer.render(world,view(c),options,1000+world.bodies.indexOf(b)*16);
    const draws=f.draws.slice(n),draw=draws.find(d=>d.uniforms.u_radius&&Math.abs(d.uniforms.u_radius[0]-.2)<1e-9);assert.ok(draw,b.id);assert.ok(draw.depth&&draw.depthWrite);assert.equal(draw.uniforms.u_cinematic[0],1);
    const projected=f.renderer.project(b.positionAU,c);near(projected.x,480);near(projected.y,320);assert.equal(f.renderer.pick(480,320,world,view(c)),b.id);
    for(const d of draws)for(const values of Object.values(d.uniforms) as number[][])assert.ok(values.every(Number.isFinite),'every uploaded uniform finite');
  }
  assert.equal(f.calls.filter(c=>c.method==='createFramebuffer').length,0,'no modal / additional rendering world');
});
test('renderer first frame requests no HD, existing loader upload is bounded and Earth texture is lazy',async t=>{
  const f=await fixture(t,1800,1800,[]),b=body('earth',[0,0,-.00009]),s=snapshot([b]);assert.equal(f.images.length,0);
  f.renderer.render(s,view(),options,1000);assert.ok(f.images.length<=2);assert.equal(f.images[0].src,'./observations/maps/earth-2k.jpg');assert.equal(f.renderer.getStats().textures!.hdLoading,0);
  f.images[0].load();for(let i=0;i<12;i++)await Promise.resolve();f.renderer.render(s,view(),options,1016);
  assert.equal(f.renderer.getStats().textures!.uploads,1);assert.ok(f.draws.at(-1).uniforms.u_hasTexture[0]===1);
  f.renderer.render(s,view(),options,1349);assert.equal(f.renderer.getStats().textures!.hdLoading,0);
  f.renderer.render(s,view(),options,1351);assert.equal(f.renderer.getStats().textures!.hdLoading,1);
  assert.ok(f.renderer.getStats().textures!.gpuBytes+f.renderer.getStats().textures!.reservedBytes<=f.renderer.getStats().textures!.budgetBytes);
});
test('translation changes actual uploaded radius and star direction while optical FOV remains fixed',async t=>{
  const f=await fixture(t),b=body(),s=snapshot([b]);f.renderer.render(s,view(),options,1000);const first=f.draws.at(-1).uniforms;
  f.renderer.render(s,view(cam([0,0,-.0005])),options,1016);const second=f.draws.at(-1).uniforms;
  near(second.u_radius[0],2*first.u_radius[0]);assert.deepEqual(second.u_tanFov,first.u_tanFov);near(second.u_logDistance[0],first.u_logDistance[0]-1);
  f.renderer.render(snapshot([]),view(cam([1000,0,0])),options,1032);assert.ok([...f.buffers.values()].some(b=>b.length===6&&b[0]<-.004));
});
test('opaque spheres are far-to-near and use actual independent surface hit depths',async t=>{
  const f=await fixture(t),nearBody=body('moon',[0,0,-.0003],1000),farBody=body('earth',[0,0,-.001]);f.renderer.render(snapshot([nearBody,farBody]),view(),options,1000);
  const draws=f.draws.filter(d=>d.uniforms.u_radius);assert.equal(draws.length,2);assert.ok(draws[0].uniforms.u_logDistance[0]>draws[1].uniforms.u_logDistance[0]);
  assert.equal(f.renderer.pick(480,320,snapshot([farBody,nearBody]),view()),'moon');
});
test('tiny distant planets are locator PSFs, not enlarged physical disks, friendly 25px pick',async t=>{
  const f=await fixture(t,960,640,[]),b=body('neptune',[0,0,-30],24764);f.renderer.render(snapshot([b]),view(),options,1000);
  assert.equal(f.renderer.getStats().resolvedBodies,0);assert.equal(f.renderer.getStats().locatorBodies,1);assert.equal(f.images.length,0);
  const d=f.draws.at(-1);assert.equal(d.args[0],0);assert.equal(d.uniforms.u_locator[0],1);assert.equal(f.renderer.pick(500,320,snapshot([b]),view()),'neptune');assert.equal(f.renderer.pick(506,320,snapshot([b]),view()),null);
});
test('empty / invalid catalog never generates replacement stars and invalid body/observer never uploads NaN',async t=>{
  const invalid={...star(),positionAU:[NaN,0,0] as Vec3};const f=await fixture(t,960,640,[invalid]);assert.equal(f.renderer.getStats().catalogCount,0);assert.equal(f.renderer.getStats().rejectedStars,1);
  f.renderer.render(snapshot([body('earth',[0,0,0]),body('bad',[NaN,0,0])]),view(),options,1000);assert.equal(f.draws.length,0);
  f.renderer.render(snapshot([body()]),view(cam([NaN,0,0])),options,1016);assert.equal(f.draws.length,0);
});
test('cinematic toggle changes only display uniforms / halo bounds, never positions, light, physical size',async t=>{
  const f=await fixture(t),b=body(),s=snapshot([b]);f.renderer.render(s,view(),options,1000);const a=f.draws.at(-1).uniforms;
  f.renderer.render(s,view(),{...options,cinematic:false},1016);const z=f.draws.at(-1).uniforms;
  for(const key of ['u_radius','u_centerNdc','u_light','u_logDistance','u_bodyRight','u_bodyUp','u_bodyForward'])assert.deepEqual(a[key],z[key]);assert.equal(z.u_cinematic[0],0);
});
test('dispose cancels pending image callbacks, releases buffers/programs and stops rendering',async t=>{
  const f=await fixture(t);f.renderer.render(snapshot([body()]),view(),options,1000);const n=f.draws.length;
  f.renderer.dispose();f.renderer.dispose();assert.equal(f.listeners.size,0);assert.equal(f.renderer.getStats().textures!.disposed,true);
  f.renderer.render(snapshot([body()]),view(),options,1016);assert.equal(f.draws.length,n);assert.ok(f.calls.some(c=>c.method==='deleteProgram'));assert.ok(f.calls.some(c=>c.method==='deleteBuffer'));
});
