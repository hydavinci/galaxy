import type {Vec3} from './types';

/** Source-derived spacecraft locator. viewDistanceAU is a framing preference,
 * never a measured spacecraft radius or collision sphere. */
export interface SpacecraftTarget {id:string;missionId:string;name:string;nameEn:string;kind:'spacecraft';positionAU:Vec3;viewDistanceAU:number;centerBodyId:string;}
