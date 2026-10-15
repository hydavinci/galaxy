import {fileURLToPath} from 'node:url';
// Focused production-method integration with a synthetic DOM. No renderer,
// browser, layout, touch-device or GPU visual acceptance is claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
import {angularDiameterCssPixels,cameraBasis,equatorialDirection,projectDirection} from '../src/observer/sky-renderer';
import type {CameraState,SkyBody,Vec3} from '../src/observer/types';
const root=fileURLToPath(new URL('../',import.meta.url)),RAD=Math.PI/180;
const anchor=(el:any)=>{const match=/^translate\(([-+\deE.]+)px,\s*([-+\deE.]+)px\)/.exec(el.style.transform)!;return {x:Number(match[1]),y:Number(match[2])};};
const near=(a:number,b:number,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
let bundled:Promise<string>|undefined;
function bundle(){return bundled??=build({absWorkingDir:root,entryPoints:['src/observer/app.ts'],bundle:true,write:false,format:'iife',globalName:'CircularFixture',platform:'browser',target:'es2020',loader:{'.css':'empty'}}).then(r=>r.outputFiles[0].text);}
async function fixture(w:number,h:number,camera:CameraState){
 const window=new Window({url:'http://localhost/',width:w,height:h}),doc=window.document;
 doc.write((await readFile(root+'tests/fixtures/observer.html','utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
 window.eval((await bundle())+'\n;window.CircularFixture=CircularFixture;');
 // Call the actual private-at-TypeScript application methods without starting
 // network/catalog/render loops. Deliberately no replacement pick/marker code.
 const app=Object.create((window as any).CircularFixture.ObserverApp.prototype);
 const canvas=doc.getElementById('sky')!;Object.defineProperty(canvas,'clientWidth',{value:w});Object.defineProperty(canvas,'clientHeight',{value:h});
 Object.assign(app,{canvas,view:{camera},state:{bodies:[]},stars:[],selected:null,tracking:false,settings:{ground:false,refraction:false,labels:false,constellations:false,atmosphere:false},immersive:true,namedLabels:new Map(),cardinals:[],constellationLabels:new Map()});
 app.renderer={projectEquatorial:(ra:number,dec:number,_state:unknown,c:CameraState)=>projectDirection(equatorialDirection(ra,dec),c,w,h)};
 app.select=(target:any)=>{app.selected=target;};app.setTracking=(v:boolean)=>{app.tracking=v;};
 const body=(id:string,x:number,y:number,radiusPx:number,distanceAU:number):SkyBody=>{
  const b=cameraBasis(camera),t=Math.tan(camera.fovDeg*RAD/2),v=b.forward.map((n,i)=>n+b.right[i]*(2*x/w-1)*t*w/h+b.up[i]*(1-2*y/h)*t) as Vec3;
  const direction=v.map(n=>n/Math.hypot(...v)) as Vec3;
  return {id,name:id,color:'#ffffff',direction,raRad:Math.atan2(direction[2],direction[0]),decRad:Math.asin(direction[1]),azimuthDeg:Math.atan2(direction[0],-direction[2])/RAD,altitudeDeg:Math.asin(direction[1])/RAD,apparentAltitudeDeg:Math.asin(direction[1])/RAD,angularDiameterRad:2*Math.atan(radiusPx*2*t/h),distanceAU,magnitude:1,illuminatedFraction:.5,sunDirection:[1,0,0]};
 };
 return {app,window,doc,body,close:()=>window.happyDOM.abort()};
}

for(const [w,h]of [[1440,900],[390,844]])test(`actual app picking uses circular limbs, nearby depth priority, unresolved 25px and isotropic markers: ${w}x${h}`,async()=>{
 const camera={azimuthDeg:0,altitudeDeg:0,fovDeg:70},f=await fixture(w,h,camera);
 try{
  const x=w*.75,y=h*.35,far=f.body('sun',x,y,50,1),nearBody=f.body('moon',x,y,30,.00257);
  // A star behind the disks and closer in screen pixels cannot steal a disk.
  f.app.stars=[{id:'background',name:'background',raRad:far.raRad,decRad:far.decRad,magnitude:0}];
  for(const bodies of [[far,nearBody],[nearBody,far]]){
   f.app.state.bodies=bodies;f.app.selected=null;f.app.pick(x,y);assert.equal(f.app.selected.id,'moon');assert.equal(f.app.tracking,true);
   f.app.selected=null;f.app.pick(x+45,y);assert.equal(f.app.selected.id,'sun','far disk only outside near limb');
  }
  f.app.state.bodies=[far];f.app.stars=[];
  for(let i=0;i<16;i++){
   const dx=Math.cos(i*Math.PI/8),dy=Math.sin(i*Math.PI/8);
   f.app.selected=null;f.app.pick(x+dx*50,y+dy*50);assert.equal(f.app.selected?.id,'sun','inclusive limb');
   f.app.selected=null;f.app.pick(x+dx*50.001,y+dy*50.001);assert.equal(f.app.selected,null,'no old pinhole ellipse hit outside circular limb');
  }
  // Small resolved Sun must not inherit the point-locator fallback.
  f.app.state.bodies=[f.body('sun',x,y,3,1)];f.app.selected=null;f.app.pick(x+20,y);assert.equal(f.app.selected,null);
  // An unresolved distant planet still has the documented friendly 25px hit.
  f.app.state.bodies=[f.body('neptune',x,y,.3,30)];f.app.selected=null;f.app.pick(x+24.9,y);assert.equal(f.app.selected?.id,'neptune');
  f.app.selected=null;f.app.pick(x+25.1,y);assert.equal(f.app.selected,null);
  // Partly visible circle remains pickable with its center beyond the viewport.
  f.app.state.bodies=[f.body('moon',-20,h/2,40,.00257)];f.app.selected=null;f.app.pick(10,h/2);assert.equal(f.app.selected?.id,'moon');
  // Labels/marker keep their true projected center and same X/Y angular scale.
  f.app.state.bodies=[far];f.app.selected={kind:'body',id:'sun'};f.app.updateSelectionMarker(w,h);
  const marker=f.doc.getElementById('selection-marker')!;
  assert.equal(marker.hidden,false);near(anchor(marker).x,x);near(anchor(marker).y,y);
  near(parseFloat(marker.style.width),angularDiameterCssPixels(far.angularDiameterRad,camera.fovDeg,h)+12);
  assert.equal(marker.style.width,marker.style.height);
 }finally{await f.close();}
});

test('actual app marker/picking retain arcsecond close-up precision away from viewport center',async()=>{
 const w=1200,h=800,camera={azimuthDeg:219,altitudeDeg:37,fovDeg:.0001},f=await fixture(w,h,camera);
 try{
  const b=f.body('neptune',w*.7,h*.3,100,30);f.app.state.bodies=[b];f.app.selected={kind:'body',id:b.id};f.app.updateSelectionMarker(w,h);
  const marker=f.doc.getElementById('selection-marker')!;near(anchor(marker).x,w*.7,1e-4);near(anchor(marker).y,h*.3,1e-4);near(parseFloat(marker.style.width),212,1e-5);
  f.app.selected=null;f.app.pick(w*.7+99.99,h*.3);assert.equal(f.app.selected?.id,b.id);
  f.app.selected=null;f.app.pick(w*.7+100.01,h*.3);assert.equal(f.app.selected,null);
 }finally{await f.close();}
});
