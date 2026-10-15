import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { AU_KM, type SpaceBody, type SpaceCamera, type SpaceSnapshot, type Vec3 } from '../src/space/types';
import { add, cameraBasis, scale } from '../src/space/math';
import { projectSpace } from '../src/space/render-math';
import { TRAJECTORY_MISSION_IDS, sampleTrajectory, type CraftState, type EphemerisTrajectoryRecord, type TrajectorySample } from '../src/space/trajectories';
import { TrajectoryOverlay, isTrajectoryPointOccluded, projectTrajectorySegment } from '../src/space/trajectory-overlay';

// All geometry/ephemerides below are synthetic fixtures, not scientific sources.
const T=Date.UTC(2026,9,15),W=800,H=600;
const camera=(patch:Partial<SpaceCamera>={}):SpaceCamera=>({positionAU:[0,0,0],azimuthDeg:0,altitudeDeg:0,fovDeg:90,...patch});
function sphere(center:Vec3=[0,0,-5],radius=1,id='earth'):SpaceBody {return {id,name:id,nameEn:id,kind:'planet',positionAU:center,radiusKm:radius*AU_KM,color:'#fff',textureId:id,axisPrime:[1,0,0],axisNorth:[0,1,0],axisEast:[0,0,1]};}
const snapshot=(bodies:SpaceBody[]=[],epoch=T):SpaceSnapshot=>({date:new Date(epoch),bodies});
const near=(a:number,b:number,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);
const record=(vertices:Vec3[]=[[-2,0,-10],[0,1,-10],[2,0,-10]],missionId='juno'):EphemerisTrajectoryRecord=>({missionId,kind:'ephemeris',label:'合成矢量测试',centerBodyId:'sun',sourceUrl:'https://example.org/fixture',sourceTarget:'-61',sourceName:'FIXTURE',solution:'Not a mission ephemeris',quality:'reconstructed',startMs:T,endMs:T+(vertices.length-1)*1000,defaultMs:T,sampleCount:vertices.length,samples:vertices.map((v,i)=>[T+i*1000,...v,0,0,0] as TrajectorySample),interpolation:'cubic-hermite',maxGapSeconds:1,maxInterpolationErrorKm:0,validationSamples:2,displayRadiusAU:1,notes:'Fixture only',sourceQueries:[{url:'https://example.org/fixture',sha256:'a'.repeat(64)}]});
const state=(positionAU:Vec3=[0,0,-10],missionId='juno',epochMs=T):CraftState=>({missionId,name:`测试 ${missionId}`,positionAU,relativePositionAU:positionAU,velocityAUPerSecond:[0,0,0],centerBodyId:'sun',viewDistanceAU:1,quality:'predicted',kind:'ephemeris',epochMs});
async function fixture(){const w=new Window({url:'https://galaxy.test/',width:W,height:H});w.document.body.innerHTML='<div id="overlay" style="position:fixed;inset:0;pointer-events:none"></div>';const root=w.document.getElementById('overlay')!,selections:string[]=[],overlay=new TrajectoryOverlay(root as any,id=>selections.push(id));return {w,root,overlay,selections,path:()=>root.querySelector('path')!,markers:()=>[...root.querySelectorAll('button')],close:async()=>{overlay.dispose();await w.happyDOM.abort();}};}
const pathNumbers=(path:string)=>Array.from(path.matchAll(/M([-\d.e+]+),([-\d.e+]+)L([-\d.e+]+),([-\d.e+]+)/g),m=>m.slice(1).map(Number));

test('finite projected segments agree with renderer projectSpace at source endpoints',()=>{
 const a:Vec3=[-1,.5,-5],b:Vec3=[1,-.5,-4],s=snapshot(),c=camera();const segments=projectTrajectorySegment(a,b,s,c,W,H);assert.equal(segments.length,1);const p=projectSpace(a,c,W,H),q=projectSpace(b,c,W,H);segments[0].forEach((v,i)=>near(v,[p.x,p.y,q.x,q.y][i]));
});
for(const [width,height] of [[800,600],[420,900],[1600,600]])for(const roll of [0,37,90,180,-91])test(`projection shares transported camera frame ${width}x${height} roll ${roll}`,()=>{
 const c=camera({positionAU:[5,-2,11],azimuthDeg:133,altitudeDeg:102,rollDeg:roll,fovDeg:68}),basis=cameraBasis(c);
 const point=(x:number,y:number,z:number)=>add(c.positionAU,add(add(scale(basis.right,x),scale(basis.up,y)),scale(basis.forward,z)));
 const a=point(-.3,.7,7),b=point(.5,-.2,6),actual=projectTrajectorySegment(a,b,snapshot(),c,width,height);assert.equal(actual.length,1);
 // Independent screen-coordinate formula given camera-basis coordinates.
 const tan=Math.tan(68*Math.PI/360),expected=[width/2-.3*height/(14*tan),height/2-.7*height/(14*tan),width/2+.5*height/(12*tan),height/2+.2*height/(12*tan)];
 actual[0].forEach((n,i)=>near(n,expected[i],1e-10));
});
test('double floating origin preserves close neighbors at a large heliocentric coordinate',()=>{
 const c=camera({positionAU:[1e8,-1e8,1e8]}),a=add(c.positionAU,[-.01,.005,-.03]),b=add(c.positionAU,[.01,-.005,-.03]);const [segment]=projectTrajectorySegment(a,b,snapshot(),c,W,H);assert.ok(segment);const p=projectSpace(a,c,W,H),q=projectSpace(b,c,W,H);segment.forEach((v,i)=>near(v,[p.x,p.y,q.x,q.y][i],1e-9));
});
test('viewport clipping preserves crossing with both endpoints outside and uses SVG bounds',()=>{
 const segments=projectTrajectorySegment([-100,0,-10],[100,0,-10],snapshot(),camera(),W,H);assert.equal(segments.length,1);near(segments[0][0],0);near(segments[0][2],W);near(segments[0][1],H/2);near(segments[0][3],H/2);
 assert.deepEqual(projectTrajectorySegment([-100,100,-10],[100,100,-10],snapshot(),camera(),W,H),[]);
});
test('near-plane crossing clips analytically, two behind endpoints vanish without NaN',()=>{
 const s=snapshot(),c=camera();assert.deepEqual(projectTrajectorySegment([-1,0,1],[1,0,2],s,c,W,H),[]);
 const segments=projectTrajectorySegment([1,0,1],[0,0,-5],s,c,W,H);assert.ok(segments.length>0);for(const segment of segments)segment.forEach((n,i)=>assert.ok(Number.isFinite(n)&&n>=0&&n<=(i%2?H:W)));
 for(const [a,b] of [[[0,0,0],[0,0,0]],[[NaN,0,-1],[1,0,-1]],[[0,0,-1e-16],[1,0,-1e-16]]] as [Vec3,Vec3][])assert.deepEqual(projectTrajectorySegment(a,b,s,c,W,H),[]);
 for(const invalid of [camera({fovDeg:0}),camera({fovDeg:180}),camera({rollDeg:NaN}),camera({positionAU:[Infinity,0,0]})])assert.deepEqual(projectTrajectorySegment([0,0,-1],[1,0,-1],s,invalid,W,H),[]);
 assert.deepEqual(projectTrajectorySegment([0,0,-1],[1,0,-1],s,c,0,H),[]);
});
test('nearest sphere occlusion distinguishes front surface, far surface, limb and empty box corners',()=>{
 const s=snapshot([sphere()]),c=camera();assert.equal(isTrajectoryPointOccluded([0,0,-10],s,c),true);assert.equal(isTrajectoryPointOccluded([0,0,-3],s,c),false);assert.equal(isTrajectoryPointOccluded([0,0,-4],s,c),false);assert.equal(isTrajectoryPointOccluded([0,0,-6],s,c),true);
 const limb:Vec3=[Math.sqrt(.96),0,-4.8];assert.equal(isTrajectoryPointOccluded(limb,s,c),false);
 assert.equal(isTrajectoryPointOccluded([1.9,1.9,-10],s,c),false); // Inside enclosing projected square, outside physical disk.
 assert.equal(isTrajectoryPointOccluded([0,0,-10],snapshot([sphere([0,0,5])]),c),false);
 assert.equal(isTrajectoryPointOccluded([0,0,-10],snapshot([sphere([0,0,-50])]),c),false);
 assert.equal(isTrajectoryPointOccluded([0,0,-10],snapshot([sphere([0,0,0])]),c),true);
 assert.equal(isTrajectoryPointOccluded([NaN,0,0],s,c),true);
});
test('occlusion uses nearest intersection independent of body input ordering',()=>{
 const far=sphere([0,0,-20],3,'jupiter'),front=sphere([0,0,-5],1,'earth'),c=camera();for(const bodies of [[far,front],[front,far]]){assert.equal(isTrajectoryPointOccluded([0,0,-10],snapshot(bodies),c),true);assert.equal(isTrajectoryPointOccluded([0,0,-3],snapshot(bodies),c),false);}
});
test('small sphere at large distance retains near-site visibility without squared-distance cancellation',()=>{
 const origin:Vec3=[100,10,-3],r=6000/AU_KM,c=camera({positionAU:add(origin,[0,0,4*r])}),s=snapshot([sphere(origin,r)]);
 assert.equal(isTrajectoryPointOccluded(add(origin,[0,0,r]),s,c),false);assert.equal(isTrajectoryPointOccluded(add(origin,[0,0,-r]),s,c),true);
});
test('path visible endpoints are split at physical limb, not connected through foreground sphere',()=>{
 const s=snapshot([sphere()]),c=camera(),segments=projectTrajectorySegment([-10,0,-10],[10,0,-10],s,c,W,H);assert.equal(segments.length,2);
 const tangent=10/Math.sqrt(24),left=W/2-tangent*H/20,right=W/2+tangent*H/20;
 near(segments[0][2],left,1e-8);near(segments[1][0],right,1e-8);assert.ok(segments[0][2]<W/2&&segments[1][0]>W/2);
});
test('analytic occlusion catches a body away from the source-segment midpoint',()=>{
 const s=snapshot([sphere([2,0,-5],.3)]),c=camera(),segments=projectTrajectorySegment([-8,0,-10],[8,0,-10],s,c,W,H);assert.equal(isTrajectoryPointOccluded([0,0,-10],s,c),false);assert.equal(segments.length,2);assert.ok(segments[0][2]>W/2);assert.ok(segments[1][0]>segments[0][2]);
});
test('a line in front of a sphere is not hidden merely because its projection overlaps the disk',()=>{
 const segments=projectTrajectorySegment([-1,0,-3],[1,0,-3],snapshot([sphere()]),camera(),W,H);assert.ok(segments.length>=1);near(segments[0][0],300);near(segments.at(-1)![2],500);
});
test('sphere surface intersection along a chord terminates at the near physical surface',()=>{
 const s=snapshot([sphere()]),c=camera(),segments=projectTrajectorySegment([-.5,0,-3],[.5,0,-7],s,c,W,H);assert.ok(segments.length>=1);assert.ok(segments.at(-1)![2]<400);for(const segment of segments)segment.forEach(Number.isFinite);
});
test('deterministic independent ray-segment oracle checks 12200 path points including multiple off-midpoint occluders',()=>{
 let seed=0x6ab71;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 let checked=0;
 for(let iteration=0;iteration<200;iteration++) {
  const c=camera({rollDeg:(random()-.5)*150}),a:Vec3=[(random()-.5)*20,(random()-.5)*10,-1-random()*14],b:Vec3=[(random()-.5)*20,(random()-.5)*10,2-random()*17];
  const bodies=[sphere([(random()-.5)*4,(random()-.5)*2,-2-random()*5],.2+random()),sphere([(random()-.5)*4,(random()-.5)*2,-2-random()*5],.2+random(),'mars')];
  const segments=projectTrajectorySegment(a,b,snapshot(bodies),c,W,H);
  for(let k=0;k<61;k++) {
   const t=(k+.37)/61,p=a.map((v,i)=>v+(b[i]-v)*t) as Vec3,projection=projectSpace(p,c,W,H);
   // Independent finite ray SEGMENT closest-point test: no production roots or
   // visibility helper participates in this occlusion oracle.
   const hidden=bodies.some(body=>{const center=body.positionAU,l2=p.reduce((sum,v)=>sum+v*v,0),u=Math.max(0,Math.min(1,center.reduce((sum,v,i)=>sum+v*p[i],0)/l2));return Math.hypot(...p.map((v,i)=>v*u-center[i]))<body.radiusKm/AU_KM;});
   const actual=segments.some(([x,y,x2,y2])=>projection.x>=Math.min(x,x2)-1e-7&&projection.x<=Math.max(x,x2)+1e-7&&projection.y>=Math.min(y,y2)-1e-7&&projection.y<=Math.max(y,y2)+1e-7);
   assert.equal(actual,projection.visible&&!hidden,`iteration ${iteration}, sample ${k}`);checked++;
  }
 }
 assert.equal(checked,12200);
});
test('overlay mounts one clipped SVG path and <=12 fixed-pixel selectable symbols, no physical radius',async()=>{
 const f=await fixture();try{const r=record(),states=TRAJECTORY_MISSION_IDS.map((id,i)=>state([(i-5.5)*.2,0,-10],id));f.overlay.update(snapshot(),camera(),states,r,true,1);
 assert.equal(f.root.querySelectorAll('svg').length,1);assert.equal(f.root.querySelectorAll('path').length,1);assert.equal(f.markers().length,12);assert.equal(f.root.querySelectorAll('canvas,img,iframe').length,0);
 for(const button of f.markers()){assert.equal(button.hidden,false);assert.equal(button.type,'button');assert.equal(button.style.width,'18px');assert.equal(button.querySelector('span')!.style.width,'7px');assert.match(button.getAttribute('aria-label')!,/非航天器物理大小/);assert.equal(button.style.pointerEvents,'auto');}
 const selected=f.root.querySelector('[data-spacecraft-marker="juno"]')!;assert.equal(selected.getAttribute('aria-pressed'),'true');(selected as any).click();assert.deepEqual(f.selections,['juno']);
 assert.match(f.path().getAttribute('clip-path')!,/^url\(#spacecraft-trajectory-clip-/);assert.equal(f.root.querySelector('rect')!.getAttribute('width'),'800');assert.equal(f.root.querySelector('rect')!.getAttribute('height'),'600');assert.equal(f.root.dataset.trajectoryFrame,'current-center-relative');assert.match(f.root.dataset.trajectoryFrameNotice!,/非所有历史日心位置/);
 }finally{await f.close();}
});
test('same-frame marker projection matches renderer across camera pan and roll, paths are refreshed',async()=>{
 const f=await fixture();try{const r=record(),s=snapshot(),states=[sampleTrajectory(r,T,s)!];let previous='';for(const c of [camera(),camera({positionAU:[.1,.2,.3],rollDeg:25}),camera({azimuthDeg:4,altitudeDeg:5,rollDeg:100})]){f.overlay.update(s,c,states,r,true,1);const button=f.markers()[0],p=projectSpace(states[0].positionAU,c,W,H),numbers=button.style.transform.match(/translate\(([-\d.e+]+)px,([-\d.e+]+)px\)/)!;near(Number(numbers[1])+9,p.x);near(Number(numbers[2])+9,p.y);const path=f.path().getAttribute('d')!;assert.notEqual(path,previous);previous=path;assert.doesNotMatch(path,/NaN|Infinity/);}
 }finally{await f.close();}
});
test('overlay polyline preserves separate occlusion/coverage segments and agrees with pure camera math',async()=>{
 const f=await fixture();try{const r=record([[-10,0,-10],[10,0,-10]]),s=snapshot([sphere()]),c=camera();f.overlay.update(s,c,[sampleTrajectory(r,T,s)!],r,true,1);const actual=pathNumbers(f.path().getAttribute('d')!),expected=projectTrajectorySegment([-10,0,-10],[10,0,-10],s,c,W,H);assert.equal(actual.length,2);actual.forEach((seg,i)=>seg.forEach((n,j)=>near(n,expected[i][j],.000001)));
 const gapped={...record([[-2,0,-10],[0,1,-10],[2,0,-10]]),samples:[[T,-2,0,-10,0,0,0],[T+1000,0,1,-10,0,0,0],[T+10000,2,0,-10,0,0,0]] as TrajectorySample[],endMs:T+10000};f.overlay.update(snapshot(),c,[state([-2,0,-10])],gapped,true,2);assert.equal(pathNumbers(f.path().getAttribute('d')!).length,1); // Never bridge the source gap.
 }finally{await f.close();}
});
test('current-center path anchoring translates every source vertex together and is explicitly labeled',async()=>{
 const f=await fixture();try{const r={...record(),centerBodyId:'earth'},first=snapshot([sphere([0,0,0],1e-6)]),second=snapshot([sphere([1,0,0],1e-6)]),c=camera({positionAU:[0,0,2]});f.overlay.update(first,c,[sampleTrajectory(r,T,first)!],r,true,1);const a=pathNumbers(f.path().getAttribute('d')!);f.overlay.update(second,c,[sampleTrajectory(r,T,second)!],r,true,2);const b=pathNumbers(f.path().getAttribute('d')!);assert.equal(a.length,2);assert.equal(b.length,2);a.forEach((seg,i)=>{near(b[i][0]-seg[0],25,1e-6);near(b[i][2]-seg[2],25,1e-6);});assert.match(f.root.dataset.trajectoryFrameNotice!,/共动/);
 }finally{await f.close();}
});
test('behind-camera/outside/occluded/stale markers hide without intercepting background input',async()=>{
 const f=await fixture();try{let bubbled=0;f.w.document.body.addEventListener('pointerdown',()=>bubbled++);const states=[state([0,0,1],'juno'),state([100,0,-2],'hubble'),state([0,0,-10],'lro'),state([0,0,-3],'webb'),state([0,0,-3],'cassini',T-1)];f.overlay.update(snapshot([sphere()]),camera(),states,undefined,true,1);const buttons=f.markers();assert.equal(buttons.filter(b=>!b.hidden).length,1);assert.equal(buttons.find(b=>!b.hidden)!.dataset.spacecraftMarker,'webb');assert.equal(buttons.some(b=>b.dataset.spacecraftMarker==='cassini'),false);
 const visible=buttons.find(b=>!b.hidden)!;visible.dispatchEvent(new f.w.Event('pointerdown',{bubbles:true}));assert.equal(bubbled,0);f.root.dispatchEvent(new f.w.Event('pointerdown',{bubbles:true}));assert.equal(bubbled,1);assert.equal(f.root.style.pointerEvents,'none');assert.equal((f.root.querySelector('svg') as any).style.pointerEvents,'none');
 for(const button of buttons)button.click();assert.deepEqual(f.selections,['webb']);f.overlay.update(snapshot(),camera(),[],undefined,false,2);assert.equal(f.root.hidden,true);visible.click();assert.deepEqual(f.selections,['webb']);
 }finally{await f.close();}
});
test('marker text is inert, historic provenance remains explicit and key activation is not prevented',async()=>{
 const f=await fixture();try{const s={...state([0,0,-3]),name:'<img src=x onerror=alert(1)>',kind:'surface-site' as const,quality:'historical-site'};f.overlay.update(snapshot(),camera(),[s],undefined,true,1);assert.equal(f.root.querySelector('img'),null);assert.ok(f.root.textContent.includes(s.name));const button=f.markers()[0];assert.match(button.getAttribute('aria-label')!,/历史着陆点；不是当前巡视器位置/);let bubbled=0;f.w.document.body.addEventListener('keydown',()=>bubbled++);const event=new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});button.dispatchEvent(event);assert.equal(event.defaultPrevented,false);assert.equal(bubbled,0);
 }finally{await f.close();}
});
test('outside source coverage, stale epoch or unselected state removes path without extrapolation',async()=>{
 const f=await fixture();try{const r=record();f.overlay.update(snapshot(),camera(),[sampleTrajectory(r,T,snapshot())!],r,true,1);assert.ok(f.path().getAttribute('d'));
 f.overlay.update(snapshot([],T-1),camera(),[state([0,0,-10],'juno',T-1)],r,true,2);assert.equal(f.path().getAttribute('d'),'');f.overlay.update(snapshot(),camera(),[state([0,0,-10],'juno',T-1)],r,true,3);assert.equal(f.path().getAttribute('d'),'');f.overlay.update(snapshot(),camera(),[state()],undefined,true,4);assert.equal(f.path().getAttribute('d'),'');
 }finally{await f.close();}
});
test('10000 source vertices are genuinely projected as 9999 bounded SVG segments, not a GPU/paint claim',async()=>{
 const f=await fixture();try{const vertices:Vec3[]=Array.from({length:10000},(_,i)=>[(i/9999-.5)*8,Math.sin(i/200),-10]),r=record(vertices);f.overlay.update(snapshot(),camera(),[sampleTrajectory(r,T,snapshot())!],r,true,1);assert.equal(f.root.dataset.trajectorySourceVertices,'10000');assert.equal(f.root.dataset.trajectoryFragments,'9999');assert.equal(f.root.dataset.trajectoryTruncated,'false');assert.equal(pathNumbers(f.path().getAttribute('d')!).length,9999);assert.doesNotMatch(f.path().getAttribute('d')!,/NaN|Infinity/);
 const oversized=record([...vertices,[0,0,-10]]);f.overlay.update(snapshot(),camera(),[state(vertices[0])],oversized,true,2);assert.equal(f.path().getAttribute('d'),'');
 }finally{await f.close();}
});
test('occlusion subdivision has an explicit 10000-fragment cap, dropping remainder instead of joining hidden spans',async()=>{
 const f=await fixture();try{const vertices:Vec3[]=Array.from({length:7501},(_,i)=>[i%2?8:-8,0,-10]),r=record(vertices),s=snapshot([sphere()]);f.overlay.update(s,camera(),[sampleTrajectory(r,T,s)!],r,true,1);assert.equal(f.root.dataset.trajectorySourceVertices,'7501');assert.equal(f.root.dataset.trajectoryFragments,'10000');assert.equal(f.root.dataset.trajectoryTruncated,'true');const segments=pathNumbers(f.path().getAttribute('d')!);assert.equal(segments.length,10000);assert.ok(segments.every(([x,,x2])=>Math.max(x,x2)<400||Math.min(x,x2)>400));
 }finally{await f.close();}
});
test('bounded marker pool rejects duplicate and unknown ids across repeated updates',async()=>{
 const f=await fixture();try{const states=[...TRAJECTORY_MISSION_IDS.map(id=>state([0,0,-3],id)),state([0,0,-3],'invented'),state([0,0,-3],'juno')];for(let i=0;i<20;i++)f.overlay.update(snapshot(),camera(),states,undefined,true,i);assert.equal(f.markers().length,12);f.overlay.update(snapshot(),camera(),[state()],undefined,true,21);assert.equal(f.markers().filter(b=>!b.hidden).length,1);
 }finally{await f.close();}
});
test('dispose is idempotent; detached saved handlers cannot select or revive resources',async()=>{
 const f=await fixture();try{const sentinel=f.w.document.createElement('div');sentinel.id='parent-owned';f.root.append(sentinel);const r=record();f.overlay.update(snapshot(),camera(),[state()],r,true,1);const button=f.markers()[0],saved=button.onclick!;f.overlay.dispose();f.overlay.dispose();saved.call(button,new f.w.MouseEvent('click') as any);button.click();f.overlay.update(snapshot(),camera(),[state()],r,true,2);assert.deepEqual(f.selections,[]);assert.equal(button.onclick,null);assert.equal(button.onpointerdown,null);assert.equal(f.root.querySelector('svg,button'),null);assert.equal(f.root.querySelector('#parent-owned'),sentinel);assert.equal(f.root.dataset.trajectoryFrame,undefined);
 }finally{await f.close();}
});
test('component does not own animation scheduling, network, WebGL, global input or physical craft geometry',()=>{
 const source=readFileSync(new URL('../src/space/trajectory-overlay.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/\b(?:requestAnimationFrame|setTimeout|setInterval|fetch|getContext|addEventListener)\s*\(/);assert.doesNotMatch(source,/Float32Array|radiusKm\s*:/);assert.match(source,/spaceCameraBasis/);assert.match(source,/projectSpace/);
});
