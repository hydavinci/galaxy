import test from 'node:test';
import assert from 'node:assert/strict';
import {focusSizeCssPixels,focusTicks} from '../src/space/focus';
import {computeSpace} from '../src/space/world';
import {bodyFrame,spaceCameraBasis} from '../src/space/render-math';
import {Navigation} from '../src/space/navigation';
import {AU_KM,type Vec3} from '../src/space/types';
const sky=computeSpace(new Date('2026-10-14T10:19:00Z'));
for(const [width,height]of[[1200,800],[390,844],[844,390]])test(`four focus ticks lie wholly outside every physical globe at ${width}x${height}`,()=>{
 const nav=new Navigation(sky),camera=nav.camera,basis=spaceCameraBasis(camera);
 for(const b of sky.bodies)for(const ratio of [.001,.02,.2,.4,.7,.95])for(const side of [0,.4]){
  const dir=basis.forward.map((v,i)=>v+basis.right[i]*side*Math.tan(camera.fovDeg*Math.PI/360)*width/height) as Vec3,len=Math.hypot(...dir),distance=b.radiusKm/AU_KM/ratio;
  const position=b.positionAU.map((v,i)=>v-dir[i]/len*distance) as Vec3,c={...camera,positionAU:position};const frame=bodyFrame(b,[0,0,0],c,width,height,false);assert.ok(frame,b.id);
  const size=focusSizeCssPixels(b.radiusKm,frame.distanceAU,c.fovDeg,width,height),radius=frame.radiusCssPixels;
  assert.ok(Math.abs(size-(2*Math.max(8,radius)+32))<1e-6);
  const cx=(frame.centerNdc[0]+1)*width/2,cy=(1-frame.centerNdc[1])*height/2,ticks=focusTicks(cx,cy,size,width,height);assert.equal(ticks.length,4);
  for(const t of ticks){
   const nx=Math.max(t.x,Math.min(cx,t.x+t.width)),ny=Math.max(t.y,Math.min(cy,t.y+t.height));
   assert.ok(Math.hypot(nx-cx,ny-cy)>=radius+6-1e-6,`${b.id}/${t.edge}: marker paints inside globe`);
  }
 }
});
test('332px globe is surrounded by a364px box; no central cross can overlap the surface',()=>{
 const radiusKm=6378.137,height=800,fov=60,tan=332/height*Math.tan(fov*Math.PI/360),ratio=tan/Math.sqrt(1+tan*tan);
 const size=focusSizeCssPixels(radiusKm,radiusKm/AU_KM/ratio,fov,1200,height);assert.ok(Math.abs(size-364)<1e-9);
 const ticks=focusTicks(600,400,size,1200,height);for(const t of ticks)assert.ok(t.visible);
 assert.deepEqual(ticks.map(t=>[t.edge,t.width,t.height]),[['top',1,10],['right',10,1],['bottom',1,10],['left',10,1]]);
});
test('focus grows/shrinks with the globe, without any inward viewport cap',()=>{
 const radius=6378.137,sizes=[8,6,4.5,3,2,1.05].map(d=>focusSizeCssPixels(radius,d*radius/AU_KM,60,1200,800));
 for(let i=1;i<sizes.length;i++)assert.ok(sizes[i]>sizes[i-1]);assert.ok(sizes.at(-1)!>800);
});
test('partially offscreen target keeps only its in-view perimeter ticks',()=>{
 const ticks=focusTicks(-25,100,120,200,200);
 assert.deepEqual(ticks.filter(t=>t.visible).map(t=>t.edge),['right']);
 const fill=focusTicks(100,100,1000,200,200);assert.equal(fill.some(t=>t.visible),false,'giant globe must not place artificial focus ticks inside view');
});
test('unknown-radius star uses hollow minimum locator, invalid physical projection hides',()=>{
 assert.equal(focusSizeCssPixels(null,100,60,1200,800),48);assert.equal(focusSizeCssPixels(6378,10,60,1200,800),48);
 for(const args of [[NaN,1,60,1200,800],[1,0,60,1200,800],[1,1,NaN,1200,800],[1,1,60,0,0],[1,1,180,1200,800],[6378,1e-10,60,1200,800]] as const)assert.equal(focusSizeCssPixels(...args),0);
 assert.deepEqual(focusTicks(0,0,NaN,1200,800),[]);
});
