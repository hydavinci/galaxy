import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SpaceRenderer } from '../src/space/renderer';
import { STELLAR_SURFACE_FRAG } from '../src/space/stellar-shaders';
import { SPACE_BODY_FRAG } from '../src/space/shaders';
import { getStellarModel } from '../src/space/stellar-model';
import { computeSpace } from '../src/space/world';
import { SATURN_RING_INNER, SATURN_RING_OUTER } from '../src/observer/saturn-rings';
import { AU_KM, type CatalogStar3D, type SpaceCamera } from '../src/space/types';
import { recordingCanvas } from './space-renderer-harness';

const catalog:CatalogStar3D[]=JSON.parse(fs.readFileSync(new URL('../public/data/space-stars.json',import.meta.url),'utf8')).stars;
const options={labels:true,orbits:false,photographicBackground:false,cinematic:true};
const snapshot=computeSpace(new Date('2026-10-14T15:00:00Z'));
const obsolete=/noise|granul|hash3|filteredNoise|u_seed|u_temperature|u_axis|sampler|\bfract\s*\(|\bsin\s*\(/i;
const source=fs.readFileSync(new URL('../src/space/renderer.ts',import.meta.url),'utf8');

test('stellar material removes old procedural features rather than lowering their contrast',()=>{
  assert.doesNotMatch(STELLAR_SURFACE_FRAG,obsolete);
  assert.doesNotMatch(STELLAR_SURFACE_FRAG,/texture|u_bodyRight|u_bodyUp|u_bodyForward|toWorld/);
  assert.match(STELLAR_SURFACE_FRAG,/vec3 globe=u_color\*\(\.78\*limb\)/);
  assert.match(STELLAR_SURFACE_FRAG,/float mu=clamp\(root\/u_radius/);
  const stellarDraw=source.slice(source.indexOf('private drawStellar('),source.indexOf('private createProgram('));
  assert.doesNotMatch(stellarDraw,/u_seed|u_temperature|u_axis|u_bodyRight|u_bodyUp|u_bodyForward/);
  assert.match(stellarDraw,/u_logDistance/);
  assert.match(STELLAR_SURFACE_FRAG,/gl_FragDepth/);
});

test('negative old procedural shader is rejected by absence contract',()=>{
  const old=fs.readFileSync(fileURLToPath(new URL('./fixtures/historical/stellar-closeup-shaders.ts',import.meta.url)),'utf8');
  assert.match(old,obsolete);
  assert.match(old,/float granules=filteredNoise/);
  assert.doesNotMatch(STELLAR_SURFACE_FRAG,obsolete);
});

test('Ruchbah stays physical-size texture-free geometry, self-emissive and fully pickable',async t=>{
  const star=catalog.find(s=>s.name==='Ruchbah')!;assert.ok(star,'actual catalog target');
  const model=getStellarModel(star)!;assert.ok(model);
  const f=recordingCanvas(),oldImage=globalThis.Image;globalThis.Image=f.FakeImage as any;
  const renderer=new SpaceRenderer(f.canvas);await renderer.init([star]);
  t.after(()=>{renderer.dispose();globalThis.Image=oldImage;});
  const radius=model.radiusKm/AU_KM;
  const camera:SpaceCamera={positionAU:[star.positionAU[0],star.positionAU[1],star.positionAU[2]+radius*4.5],azimuthDeg:0,altitudeDeg:0,rollDeg:0,fovDeg:60};
  const view={camera,selectedId:star.id,mode:'orbit' as const,speedAUPerSecond:.1};
  renderer.render({date:snapshot.date,bodies:[]},view,options,10);
  const draws=f.draws.filter(d=>d.shaders.includes(STELLAR_SURFACE_FRAG));assert.equal(draws.length,1);
  const draw=draws[0];assert.ok(draw.depth&&draw.depthWrite);assert.equal(draw.uniforms.u_surfaceMix[0],1);
  for(const key of Object.keys(draw.uniforms))assert.doesNotMatch(key,/u_seed|u_temperature|u_axis|u_light|u_texture|u_time/);
  assert.equal(f.images.length,0);assert.equal(renderer.getStats().textures!.uploads,0);
  assert.ok(Math.abs(draw.uniforms.u_radius[0]-1/4.5)<1e-8);
  const frame=renderer.getStellarFrames()[0];assert.ok(frame.radiusCssPixels>100);
  assert.equal(renderer.pick(480+frame.radiusCssPixels*.8,320,{date:snapshot.date,bodies:[]},view),star.id);
  assert.equal(renderer.pick(480+frame.radiusCssPixels+2,320,{date:snapshot.date,bodies:[]},view),null);
  renderer.render({date:new Date('2040-01-01'),bodies:[]},{...view,camera:{...camera,rollDeg:137}},options,1000);
  assert.deepEqual(f.draws.filter(d=>d.shaders.includes(STELLAR_SURFACE_FRAG)).at(-1).uniforms,draw.uniforms);
});

test('Saturn retains neutral geometry without a ring image; verified-profile branch is explicit and cannot leak to Earth',async t=>{
  const f=recordingCanvas(),oldImage=globalThis.Image;globalThis.Image=f.FakeImage as any;
  const renderer=new SpaceRenderer(f.canvas);await renderer.init([]);
  t.after(()=>{renderer.dispose();globalThis.Image=oldImage;});
  // Resource readiness is controlled here; loading/provenance has separate tests.
  let ready=false;const manager=(renderer as any).textureManager;
  manager.get=(id:string)=>ready&&id==='saturn-ring'?{ready:true,texture:{},tier:2}:undefined;
  const body=snapshot.bodies.find(b=>b.id==='saturn')!,r=body.radiusKm/AU_KM;
  const camera:SpaceCamera={positionAU:[body.positionAU[0],body.positionAU[1],body.positionAU[2]+r*7],azimuthDeg:0,altitudeDeg:0,rollDeg:0,fovDeg:60};
  const view={camera,selectedId:'saturn',mode:'orbit' as const,speedAUPerSecond:.1};
  renderer.render({date:snapshot.date,bodies:[body]},view,options,1);
  const a=f.draws.at(-1);assert.equal(a.uniforms.u_hasRing[0],1);assert.equal(a.uniforms.u_hasTexture[0],0);
  assert.deepEqual(a.uniforms.u_ringRadii,[SATURN_RING_INNER,SATURN_RING_OUTER]);assert.ok(a.depth&&a.depthWrite);
  ready=true;renderer.render({date:snapshot.date,bodies:[body]},view,options,20);
  const b=f.draws.at(-1);assert.equal(b.uniforms.u_hasRing[0],2);
  for(const key of ['u_radius','u_logDistance','u_rect','u_axisNorth'])assert.deepEqual(a.uniforms[key],b.uniforms[key]);
  renderer.render({date:snapshot.date,bodies:[{...body,id:'earth',textureId:'earth'}]},view,options,40);
  assert.equal(f.draws.at(-1).uniforms.u_hasRing[0],0);
  assert.match(SPACE_BODY_FRAG,/vec4 profile=vec4\(\.65,\.65,\.65,\.55\)/);
  assert.match(SPACE_BODY_FRAG,/if\(u_hasRing>1\.5\)profile=texture/);
  assert.match(SPACE_BODY_FRAG,/bool front=!sphereHit\|\|along < -sqrt/);
  assert.match(SPACE_BODY_FRAG,/planetShadow/);
});
