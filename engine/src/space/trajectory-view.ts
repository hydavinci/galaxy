import type {EphemerisTrajectoryRecord} from './trajectories';
import type {Vec3} from './types';
import {add,cross,normalizedOr,scale} from './math';
export interface TrajectoryViewFrame {offsetAU:Vec3;radiusAU:number;direction:Vec3;}
/** A view frame for the provided source-knot window, not a new orbit or state.
 * Its center-relative bounds remain fixed as simulation time advances. */
export function trajectoryViewFrame(record:EphemerisTrajectoryRecord):TrajectoryViewFrame {
 const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
 for(const s of record.samples)for(let i=0;i<3;i++){min[i]=Math.min(min[i],s[i+1]);max[i]=Math.max(max[i],s[i+1]);}
 const offsetAU=min.map((v,i)=>(v+max[i])/2) as Vec3;
 let radiusAU=0;for(const s of record.samples)radiusAU=Math.max(radiusAU,Math.hypot(s[1]-offsetAU[0],s[2]-offsetAU[1],s[3]-offsetAU[2]));
 const s=record.samples[Math.floor(record.samples.length/2)],r:Vec3=[s[1],s[2],s[3]],v:Vec3=[s[4],s[5],s[6]],normal=cross(r,v);
 // Prefer a near-orbit-normal view so an almost edge-on path is not mistaken
 // for a static point. Neither this camera direction nor its size is physics.
 const direction=normalizedOr(add(normalizedOr(normal,[0,1,0]),scale(normalizedOr(r,[0,0,1]),.15)),[0,1,0]);
 return {offsetAU,radiusAU:Math.max(radiusAU,record.displayRadiusAU*.005,1e-9),direction};
}
/** Bias the initial camera toward the selected craft's side of its host, so a
 * low-orbit default is not hidden behind the planet. Subsequent motion is free
 * to be naturally occulted; this is not continuous camera following. */
export function trajectoryViewDirection(frame:TrajectoryViewFrame,relativePositionAU:Vec3):Vec3 {
 return normalizedOr(add(frame.direction,scale(normalizedOr(relativePositionAU,[0,0,1]),.5)),frame.direction);
}
export function trajectoryViewDistance(frame:TrajectoryViewFrame,fovDeg:number,width:number,height:number):number {
 const halfAngle=Math.atan(Math.tan(fovDeg*Math.PI/360)*Math.min(1,Math.max(1,width)/Math.max(1,height)));
 return Math.max(1e-8,frame.radiusAU*1.2/Math.sin(halfAngle));
}
