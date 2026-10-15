import type { SpaceCamera, Vec3 } from './types';

export const DEG = Math.PI / 180;
/** Numerical domain, not the extent of an observed/complete universe model. */
export const MAX_COORDINATE_AU = 1e12;
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0]*s, a[1]*s, a[2]*s];
export const dot = (a: Vec3, b: Vec3): number => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const length = (v: Vec3): number => Math.hypot(...v);
export const distance = (a: Vec3, b: Vec3): number => length(subtract(a,b));
export function finiteVector(v: Vec3, label='vector'): void {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new RangeError(`Invalid ${label}`);
}
export function finitePosition(v: Vec3): void {
  finiteVector(v, 'position');
  if(v.some(n => Math.abs(n) > MAX_COORDINATE_AU)) throw new RangeError('Position exceeds numerical world bounds');
}
export function normalize(v: Vec3): Vec3 {
  const n=length(v);
  if (!(n>0) || !Number.isFinite(n)) throw new RangeError('Invalid direction');
  return scale(v,1/n);
}
export function normalizedOr(v: Vec3, fallback: Vec3): Vec3 {
  return length(v)>1e-20 ? normalize(v) : [...fallback];
}
export const wrapDegrees = (n: number): number => ((n%360)+360)%360;
export const signedDegrees = (n:number):number => wrapDegrees(n+180)-180;
export type CameraOrientation = Pick<SpaceCamera,'azimuthDeg'|'altitudeDeg'|'rollDeg'>;
export interface CameraBasis { forward:Vec3; right:Vec3; up:Vec3; }
export function directionAngles(v: Vec3): {azimuthDeg:number;altitudeDeg:number} {
  const n=normalize(v);
  return { azimuthDeg:wrapDegrees(Math.atan2(n[0],-n[2])/DEG), altitudeDeg:Math.asin(clamp(n[1],-1,1))/DEG };
}
export function directionFromAngles(azimuthDeg:number,altitudeDeg:number): Vec3 {
  const a=wrapDegrees(azimuthDeg)*DEG,p=signedDegrees(altitudeDeg)*DEG,c=Math.cos(p);
  return [c*Math.sin(a), Math.sin(p), -c*Math.cos(a)];
}
export function cameraBasis(camera:CameraOrientation):CameraBasis {
  const forward=directionFromAngles(camera.azimuthDeg,camera.altitudeDeg),a=wrapDegrees(camera.azimuthDeg)*DEG;
  const right:Vec3=[Math.cos(a),0,Math.sin(a)],up=cross(right,forward),r=signedDegrees(camera.rollDeg??0)*DEG;
  return {forward,right:add(scale(right,Math.cos(r)),scale(up,Math.sin(r))),up:add(scale(up,Math.cos(r)),scale(right,-Math.sin(r)))};
}
/** Euler values are only serialization of a continuous screen frame. Choose the
 * nearby pitch branch, retaining yaw at a pole rather than resetting the horizon. */
function orientationFromBasis(b:CameraBasis,reference:CameraOrientation):CameraOrientation {
  const horizontal=Math.hypot(b.forward[0],b.forward[2]);
  let azimuthDeg=reference.azimuthDeg,altitudeDeg=Math.atan2(b.forward[1],horizontal)/DEG;
  if(horizontal>1e-12) {
    azimuthDeg=wrapDegrees(Math.atan2(b.forward[0],-b.forward[2])/DEG);
    if(Math.abs(signedDegrees(azimuthDeg-reference.azimuthDeg))>90) {azimuthDeg=wrapDegrees(azimuthDeg+180);altitudeDeg=180-altitudeDeg;}
  }
  altitudeDeg=signedDegrees(altitudeDeg);
  const base=cameraBasis({azimuthDeg,altitudeDeg});
  const rollDeg=signedDegrees(Math.atan2(dot(b.right,base.up),dot(b.right,base.right))/DEG);
  return {azimuthDeg:wrapDegrees(azimuthDeg),altitudeDeg,rollDeg};
}
function rotateVector(v:Vec3,axis:Vec3,radians:number):Vec3 {
  const c=Math.cos(radians),s=Math.sin(radians);
  return add(add(scale(v,c),scale(cross(axis,v),s)),scale(axis,dot(axis,v)*(1-c)));
}
/** Exact finite rotation about a combined screen-local drag axis. Subdividing a
 * straight drag yields the same orientation, including at/inverted past poles. */
export function rotateCamera(camera:CameraOrientation,horizontalDeg:number,verticalDeg:number):CameraOrientation {
  const angle=Math.hypot(horizontalDeg,verticalDeg);
  if(!Number.isFinite(angle))throw new RangeError('Invalid camera rotation');
  if(angle===0)return {azimuthDeg:camera.azimuthDeg,altitudeDeg:camera.altitudeDeg,rollDeg:camera.rollDeg??0};
  const b=cameraBasis(camera),axis=add(scale(b.up,horizontalDeg/angle),scale(b.right,verticalDeg/angle));
  const rotate=(v:Vec3)=>rotateVector(v,axis,signedDegrees(angle)*DEG);
  return orientationFromBasis({forward:rotate(b.forward),right:rotate(b.right),up:rotate(b.up)},camera);
}
/** Parallel-transport the screen frame while facing a new target, with no
 * global-up reconstruction. Aligned tracking/dolly frames are exact no-ops. */
export function faceCamera(camera:CameraOrientation,direction:Vec3):CameraOrientation {
  const b=cameraBasis(camera),forward=normalize(direction),turn=cross(b.forward,forward),s=length(turn),c=clamp(dot(b.forward,forward),-1,1);
  if(s<1e-14&&c>0)return {azimuthDeg:camera.azimuthDeg,altitudeDeg:camera.altitudeDeg,rollDeg:camera.rollDeg??0};
  const axis=s>1e-14?scale(turn,1/s):b.up;
  const transported=rotateVector(b.right,axis,Math.atan2(s,c));
  const right=normalize(subtract(transported,scale(forward,dot(transported,forward))));
  return orientationFromBasis({forward,right,up:cross(right,forward)},camera);
}
