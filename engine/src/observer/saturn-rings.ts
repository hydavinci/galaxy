import type { Vec3 } from './types';
import { clampFov } from './zoom';

/** Approximate C-ring inner edge and A-ring outer edge / Saturn equatorial radius.
 * NASA PDS Ring-Moon Systems: 74,491 km / 60,268 km and 136,770 km / 60,268 km.
 * https://pds-rings.seti.org/saturn/saturn_rings_table.html
 * The approximately 1.236..2.269 annulus intentionally omits the faint D/E/F/G rings; the RGBA
 * radial profile supplies C/B/A band opacity and gaps, not invented geometry.
 * Saturn's existing scientific sphere radius is NOT changed by these bounds.
 */
export const SATURN_RING_INNER = 74491 / 60268;
export const SATURN_RING_OUTER = 136770 / 60268;
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=(p:Vec3):Vec3=>{const l=Math.hypot(...p);return p.map(v=>v/l) as Vec3;};

/** Reference intersection for tests/optional overlays in the body's transported
 * optical frame (forward +Z). The rendering shader uses the same stable plane
 * equation; no subtraction of almost equal unit-distance positions. Ring picking
 * is deliberately NOT wired into bodyDiskContains: existing selection is circle-only.
 */
export function intersectSaturnRing(rayDirection:Vec3,radius:number,northLocal:Vec3) {
  if(!(radius>0&&radius<1/SATURN_RING_OUTER)||!rayDirection.every(Number.isFinite)||!northLocal.every(Number.isFinite))return null;
  const ray=normalize(rayDirection),north=normalize(northLocal);
  if(!(ray[2]>0)||!north.every(Number.isFinite))return null;
  const closest=cross(ray,cross(ray,[0,0,1])),denominator=dot(ray,north);
  // An ideal zero-thickness plane has zero projected area when precisely edge-on.
  if(Math.abs(denominator)<1e-7)return null;
  const along=-dot(closest,north)/denominator;
  const point=closest.map((x,i)=>(x+ray[i]*along)/radius) as Vec3;
  const radial=Math.hypot(...point);
  if(ray[2]+along<=0||radial<SATURN_RING_INNER||radial>SATURN_RING_OUTER)return null;
  const discriminant=radius*radius-dot(closest,closest);
  return {point,radial,radialUv:(radial-SATURN_RING_INNER)/(SATURN_RING_OUTER-SATURN_RING_INNER),along,
    sphereHit:discriminant>=0,inFrontOfSphere:discriminant<0||along < -Math.sqrt(discriminant)};
}

/** Parallel sunlight, spherical planet umbra; excludes finite solar size,
 * ring self-shadowing, and rings casting a shadow onto the globe. */
export function planetShadowsRing(pointInPlanetRadii:Vec3,toSun:Vec3):boolean {
  const light=normalize(toSun),b=dot(pointInPlanetRadii,light);
  return b<0&&dot(pointInPlanetRadii,pointInPlanetRadii)-b*b<1;
}

/** Fit the complete main-ring bounding sphere to 70% of the shorter CSS side.
 * This is navigation only. The public scientific angular diameter is untouched. */
export function inspectionRingFov(angularDiameterRad:number,width=1200,height=800):number {
  if(!(angularDiameterRad>0&&angularDiameterRad<Math.PI)||!(width>0&&height>0))return clampFov(60);
  const r=Math.min(.999999,Math.sin(angularDiameterRad/2)*SATURN_RING_OUTER);
  return clampFov(2*Math.atan(r/Math.sqrt(1-r*r)/(.70*Math.min(1,width/height)))*180/Math.PI);
}
