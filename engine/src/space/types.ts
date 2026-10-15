export type Vec3 = [number, number, number];
export const AU_KM = 149597870.7;
export const PARSEC_AU = 206264.80624709636;
export interface SpaceBody {
  id:string; name:string; nameEn:string; kind:'star'|'planet'|'moon';
  positionAU:Vec3; radiusKm:number; color:string; textureId:string; parentId?:string;
  axisNorth:Vec3; axisPrime:Vec3; axisEast:Vec3;
}
export interface SpaceSnapshot { date:Date; bodies:SpaceBody[]; }
export interface CatalogStar3D {
  id:string; name:string; nameZh?:string; positionAU:Vec3;
  absoluteMagnitude:number; bv:number; distancePc:number; sourceId:string;
}
/** Inertial Euler orientation, NOT geographic latitude. Pitch may cross either
 * pole; optional roll carries the transported screen frame (no roll control).
 * Legacy cameras without rollDeg retain their original upright basis. */
export interface SpaceCamera { positionAU:Vec3; azimuthDeg:number; altitudeDeg:number; rollDeg?:number; fovDeg:number; }
export interface SpaceView { camera:SpaceCamera; selectedId:string|null; mode:'orbit'|'free'; speedAUPerSecond:number; }
export interface SpaceRenderOptions { labels:boolean; orbits:boolean; photographicBackground:boolean; cinematic:boolean; }
export interface SpaceProjection { x:number; y:number; visible:boolean; distanceAU:number; }
