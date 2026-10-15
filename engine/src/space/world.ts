import * as AstronomyModule from 'astronomy-engine';
// Astronomy Engine 2.1.19 is wrapped differently by native Vite and Node/tsx.
const Astronomy: typeof AstronomyModule = Reflect.get(AstronomyModule, 'default') ?? AstronomyModule;
import { AU_KM, type SpaceBody, type SpaceSnapshot, type Vec3 } from './types';
import { DEG, add, clamp, dot, finitePosition, length, normalize, scale, subtract } from './math';

export const MIN_SPACE_TIME = Date.UTC(1900, 0, 1);
export const MAX_SPACE_TIME = Date.UTC(2101, 0, 1)-1;
export function validateSpaceDate(date: Date): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new RangeError('Invalid space date');
  if(date.getTime()<MIN_SPACE_TIME || date.getTime()>MAX_SPACE_TIME) throw new RangeError('Supported UTC dates: 1900-01-01 through 2100-12-31');
}

// Physical reference radii in km; equatorial radii for oblate planets, spherical
// render geometry. No screen-space enlargement is represented as physical size.
const DEFINITIONS: ReadonlyArray<{id:string;name:string;body:AstronomyModule.Body;radiusKm:number;color:string;kind:SpaceBody['kind'];parentId?:string}> = [
  {id:'sun',name:'太阳',body:Astronomy.Body.Sun,radiusKm:695700,color:'#fff2bd',kind:'star'},
  {id:'mercury',name:'水星',body:Astronomy.Body.Mercury,radiusKm:2439.7,color:'#b4aaa0',kind:'planet',parentId:'sun'},
  {id:'venus',name:'金星',body:Astronomy.Body.Venus,radiusKm:6051.8,color:'#ffedbf',kind:'planet',parentId:'sun'},
  {id:'earth',name:'地球',body:Astronomy.Body.Earth,radiusKm:6378.137,color:'#9dcaff',kind:'planet',parentId:'sun'},
  {id:'moon',name:'月球',body:Astronomy.Body.Moon,radiusKm:1737.4,color:'#e3e6e9',kind:'moon',parentId:'earth'},
  {id:'mars',name:'火星',body:Astronomy.Body.Mars,radiusKm:3396.19,color:'#e8926e',kind:'planet',parentId:'sun'},
  {id:'jupiter',name:'木星',body:Astronomy.Body.Jupiter,radiusKm:71492,color:'#e4cba4',kind:'planet',parentId:'sun'},
  {id:'saturn',name:'土星',body:Astronomy.Body.Saturn,radiusKm:60268,color:'#e5d8af',kind:'planet',parentId:'sun'},
  {id:'uranus',name:'天王星',body:Astronomy.Body.Uranus,radiusKm:25559,color:'#a9e6e6',kind:'planet',parentId:'sun'},
  {id:'neptune',name:'海王星',body:Astronomy.Body.Neptune,radiusKm:24764,color:'#789bed',kind:'planet',parentId:'sun'},
];

function engineVector(v: {x:number;y:number;z:number}): Vec3 { return [v.x,v.z,v.y]; }
function rotationBasis(body: AstronomyModule.Body,date: Date): Pick<SpaceBody,'axisNorth'|'axisPrime'|'axisEast'> {
  const axis=Astronomy.RotationAxis(body,date),a=axis.ra*15*DEG,d=axis.dec*DEG,w=(axis.spin%360)*DEG;
  // Construct in IAU EQJ then apply the explicit Y/Z permutation to all three.
  // cross(prime,east) = -north in this reflected engine coordinate convention.
  const q:Vec3=[-Math.sin(a),0,Math.cos(a)];
  const t:Vec3=[-Math.sin(d)*Math.cos(a),Math.cos(d),-Math.sin(d)*Math.sin(a)];
  return {
    axisNorth:normalize(engineVector(axis.north)),
    axisPrime:normalize(add(scale(q,Math.cos(w)),scale(t,Math.sin(w)))),
    axisEast:normalize(add(scale(q,-Math.sin(w)),scale(t,Math.cos(w)))),
  };
}

/**
 * Time-driven instantaneous geometric ephemeris, not an N-body simulation or a
 * terrestrial sky. Every target shares one heliocentric J2000 world in AU.
 * No light-time/aberration, observer horizon, surface parallax or refraction.
 */
export function computeSpace(date: Date): SpaceSnapshot {
  validateSpaceDate(date);
  const safeDate=new Date(date.getTime()), earth=engineVector(Astronomy.HelioVector(Astronomy.Body.Earth,safeDate));
  const bodies=DEFINITIONS.map(({body,id,name,radiusKm,color,kind,parentId}): SpaceBody => {
    const positionAU:Vec3=body===Astronomy.Body.Sun ? [0,0,0]
      : body===Astronomy.Body.Earth ? [...earth]
      : body===Astronomy.Body.Moon ? add(earth,engineVector(Astronomy.GeoMoon(safeDate)))
      : engineVector(Astronomy.HelioVector(body,safeDate));
    finitePosition(positionAU);
    return {id,name,nameEn:body,kind,positionAU,radiusKm,color,textureId:id,...(parentId?{parentId}:{}),...rotationBasis(body,safeDate)};
  });
  return {date:safeDate,bodies};
}

/** Floating origin: do this in JS double BEFORE any Float32Array/projection. */
export function relativePositionAU(positionAU:Vec3,cameraPositionAU:Vec3): Vec3 {
  finitePosition(positionAU);finitePosition(cameraPositionAU);
  return subtract(positionAU,cameraPositionAU);
}

export interface BodyObservation {
  distanceAU:number; altitudeAU:number; radiusAU:number; direction:Vec3;
  angularDiameterRad:number; sunDirection:Vec3|null; illuminatedFraction:number; isEmissive:boolean;
}
/** Observer-dependent geometry. Phase is the conventional spherical (1+cosα)/2
 * proxy, not a near-camera perspective pixel-area measurement. No eclipses,
 * finite-Sun penumbra, surface BRDF or atmosphere. Renderer shades true rays. */
export function observeBody(body:SpaceBody,cameraPositionAU:Vec3,sunPositionAU:Vec3=[0,0,0]): BodyObservation {
  const delta=relativePositionAU(body.positionAU,cameraPositionAU),distanceAU=length(delta),radiusAU=body.radiusKm/AU_KM;
  finitePosition(sunPositionAU);
  if(!(radiusAU>0) || !Number.isFinite(radiusAU)) throw new RangeError('Invalid body radius');
  if(!(distanceAU>radiusAU)) throw new RangeError('Observer must be outside the physical body');
  const direction=scale(delta,1/distanceAU),isEmissive=body.id==='sun';
  const sunDirection=isEmissive ? null : normalize(subtract(sunPositionAU,body.positionAU));
  return {distanceAU,altitudeAU:distanceAU-radiusAU,radiusAU,direction,
    angularDiameterRad:2*Math.asin(clamp(radiusAU/distanceAU,0,1)),sunDirection,
    illuminatedFraction:sunDirection ? clamp((1-dot(direction,sunDirection))/2,0,1) : 1,isEmissive};
}
