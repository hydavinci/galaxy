import { AU_KM, PARSEC_AU } from './types';
export const LIGHTYEAR_AU = PARSEC_AU / 3.2615637771674336;
export function formatDistance(au:number):string {
 const distance=Math.abs(au);
 if(!Number.isFinite(distance))return '—';
 if(distance>=LIGHTYEAR_AU*.1)return `${(distance/LIGHTYEAR_AU).toLocaleString('zh-CN',{maximumFractionDigits:3})} 光年`;
 if(distance>=.01)return `${distance.toLocaleString('zh-CN',{maximumFractionDigits:4})} AU`;
 return `${(distance*AU_KM).toLocaleString('zh-CN',{maximumFractionDigits:distance*AU_KM<10?2:0})} km`;
}
export function formatSpeed(auPerSecond:number):string{return `${formatDistance(auPerSecond)}/s`;}
export function clamp(value:number,low:number,high:number):number{return Math.max(low,Math.min(high,value));}
