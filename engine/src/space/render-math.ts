import { AU_KM, PARSEC_AU, type CatalogStar3D, type SpaceBody, type SpaceCamera, type SpaceProjection, type Vec3 } from './types';
import { SATURN_RING_OUTER } from '../observer/saturn-rings';
import { cameraBasis } from './math';

export const RAD = Math.PI / 180;
export const clamp = (x:number, lo:number, hi:number) => Math.max(lo, Math.min(hi, x));
export const dot = (a:Vec3,b:Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const subtract = (a:Vec3,b:Vec3):Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export function unit(a:Vec3):Vec3 { const d=Math.hypot(...a); return d>0&&Number.isFinite(d)?[a[0]/d,a[1]/d,a[2]/d]:[0,0,0]; }
export const finiteVector = (v:Vec3) => v.length===3&&v.every(Number.isFinite);
export function validCamera(c:SpaceCamera):boolean {
  return finiteVector(c.positionAU)&&Number.isFinite(c.azimuthDeg)&&Number.isFinite(c.altitudeDeg)&&Number.isFinite(c.rollDeg??0)&&Number.isFinite(c.fovDeg)&&c.fovDeg>0&&c.fovDeg<179;
}
/** Navigation, projection, picking, markers and GPU uploads use one screen frame. */
export const spaceCameraBasis = cameraBasis;
/** Always subtract doubles BEFORE a float32 conversion. Includes large origins / close neighbors. */
export function relativePosition(positionAU:Vec3,cameraPositionAU:Vec3) {
  if(!finiteVector(positionAU)||!finiteVector(cameraPositionAU))return null;
  const vector=subtract(positionAU,cameraPositionAU),distanceAU=Math.hypot(...vector);
  if(!(distanceAU>0)||!Number.isFinite(distanceAU))return null;
  const direction:Vec3=[vector[0]/distanceAU,vector[1]/distanceAU,vector[2]/distanceAU];
  return {vector,direction,distanceAU};
}
export function projectSpace(positionAU:Vec3,camera:SpaceCamera,width:number,height:number):SpaceProjection {
  const relative=relativePosition(positionAU,camera.positionAU);
  if(!relative||!validCamera(camera)||!(width>0&&height>0))return {x:-1,y:-1,visible:false,distanceAU:relative?.distanceAU??0};
  const {right,up,forward}=spaceCameraBasis(camera),depth=dot(relative.direction,forward);
  if(!(depth>1e-15))return {x:-1,y:-1,visible:false,distanceAU:relative.distanceAU};
  const tan=Math.tan(camera.fovDeg*RAD/2),nx=dot(relative.direction,right)/(depth*tan*width/height),ny=dot(relative.direction,up)/(depth*tan);
  return {x:(nx+1)*width/2,y:(1-ny)*height/2,visible:Math.abs(nx)<=1&&Math.abs(ny)<=1&&Number.isFinite(nx+ny),distanceAU:relative.distanceAU};
}
export interface BodyFrame {
  body:SpaceBody; distanceAU:number; direction:Vec3; radius:number; radiusAU:number;
  light:Vec3; logDistance:number; centerNdc:[number,number]; rect:[number,number,number,number];
  right:Vec3; up:Vec3; forward:Vec3; radiusCssPixels:number;
}
/** Finite-position sphere → circular local optical window; no invented enlarged globe.
 * Extent increases only the draw rectangle for rings / cinematic atmosphere. */
export function bodyFrame(body:SpaceBody,sunPositionAU:Vec3,camera:SpaceCamera,width:number,height:number,cinematic=false):BodyFrame|null {
  const r=relativePosition(body.positionAU,camera.positionAU),radiusAU=body.radiusKm/AU_KM;
  if(!r||!validCamera(camera)||!(width>0&&height>0)||!(radiusAU>0)||!Number.isFinite(radiusAU)||![body.axisNorth,body.axisPrime,body.axisEast].every(v=>finiteVector(v)&&Math.hypot(...v)>.5))return null;
  const radius=radiusAU/r.distanceAU;
  // Navigation guards collision. Invalid/inside snapshots fail closed, never NaN uniforms.
  if(!(radius>0&&radius<1))return null;
  const b=spaceCameraBasis(camera),forward=r.direction;
  const x=dot(forward,b.right),y=dot(forward,b.up),z=dot(forward,b.forward);
  if(!(z>1e-15))return null;
  const ty=Math.tan(camera.fovDeg*RAD/2),tx=ty*width/height;
  const tangent=radius/Math.sqrt((1-radius)*(1+radius));
  const id=body.id.toLowerCase();
  const extent=id==='saturn'?SATURN_RING_OUTER:cinematic?(id==='sun'?1.35:id==='earth'?1.045:id==='mars'?1.025:1):1;
  const er=radius*extent;
  // A ring / atmosphere can enclose the observer's bounding sphere while the
  // actual globe doesn't. Keep a full-screen bounded quad instead of dropping it.
  const bound=er>=1?1e12:er/Math.sqrt((1-er)*(1+er));
  const cx=x/z,cy=y/z;
  if(Math.hypot(Math.max(0,Math.abs(cx)-tx),Math.max(0,Math.abs(cy)-ty))>bound)return null;
  const centerNdc:[number,number]=[cx/tx,cy/ty];
  const rect:[number,number,number,number]=[Math.max(-1,centerNdc[0]-bound/tx),Math.max(-1,centerNdc[1]-bound/ty),Math.min(1,centerNdc[0]+bound/tx),Math.min(1,centerNdc[1]+bound/ty)];
  const k=1/(1+z),fromView=(p:Vec3):Vec3=>[b.right[0]*p[0]+b.up[0]*p[1]+b.forward[0]*p[2],b.right[1]*p[0]+b.up[1]*p[1]+b.forward[1]*p[2],b.right[2]*p[0]+b.up[2]*p[1]+b.forward[2]*p[2]];
  return {body,distanceAU:r.distanceAU,direction:r.direction,radius,radiusAU,logDistance:Math.log2(r.distanceAU),light:unit(subtract(sunPositionAU,body.positionAU)),centerNdc,rect,
    right:fromView([1-x*x*k,-x*y*k,-x]),up:fromView([-x*y*k,1-y*y*k,-y]),forward,radiusCssPixels:height*tangent/(2*ty)};
}
/** Same depth mapping as the sphere fragment shader, in AU. */
export function logarithmicDepth(distanceAU:number):number {
  return clamp((Math.log2(Math.max(1e-30,distanceAU))+40)/80,1e-7,.999999);
}
export function starMagnitude(star:CatalogStar3D,distanceAU:number):number {
  return star.absoluteMagnitude+5*Math.log10(Math.max(1e-15,distanceAU/PARSEC_AU)/10);
}
/** A 2D Earth-neighborhood survey is NOT a 3D galaxy: fade 0.05–0.5 pc from Sun. */
export function photographicBackgroundWeight(positionAU:Vec3):number {
  const pc=Math.hypot(...positionAU)/PARSEC_AU;
  if(!Number.isFinite(pc)||pc>=.5)return 0;
  if(pc<=.05)return 1;
  const t=(pc-.05)/.45;return 1-t*t*(3-2*t);
}
export function illuminatedFraction(frame:Pick<BodyFrame,'direction'|'light'>):number { return clamp((1-dot(frame.direction,frame.light))/2,0,1); }
/** Loader motion should measure rendered body-relative orientation, not absolute
 * heliocentric travel. A locked observer that follows a translating body is stable;
 * a true orbit / surface rotation remains moving even with a fixed screen center. */
export function textureCamera(frame:BodyFrame|undefined,camera:SpaceCamera) {
  if(!frame)return {azimuthDeg:camera.azimuthDeg,altitudeDeg:camera.altitudeDeg,fovDeg:camera.fovDeg};
  const d=frame.direction,b=frame.body;
  const x=dot(d,b.axisPrime),y=dot(d,b.axisNorth),z=dot(d,b.axisEast);
  return {azimuthDeg:Math.atan2(z,x)/RAD,altitudeDeg:Math.asin(clamp(y,-1,1))/RAD,fovDeg:camera.fovDeg};
}
/** CPU exact limb + nearest surface distance, sharing the circular optics. */
export function bodyHitDistance(frame:BodyFrame,x:number,y:number,width:number,height:number,camera:SpaceCamera):number|null {
  if(!Number.isFinite(x+y)||x<0||y<0||x>width||y>height)return null;
  const nx=2*x/width-1,ny=1-2*y/height,tan=Math.tan(camera.fovDeg*RAD/2);
  const rx=(nx-frame.centerNdc[0])*tan*width/height,ry=(ny-frame.centerNdc[1])*tan;
  const length=Math.hypot(rx,ry,1),z=1/length,closest2=(rx*rx+ry*ry)/(length*length),disc=frame.radius*frame.radius-closest2;
  if(disc < -frame.radius*frame.radius*1e-12)return null;
  return frame.distanceAU*(z-Math.sqrt(Math.max(0,disc)));
}
