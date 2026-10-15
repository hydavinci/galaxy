import { PARSEC_AU, type CatalogStar3D } from './types';
export interface SpatialCatalog { stars:CatalogStar3D[]; description:string; warning:string|null; metadata:Record<string,unknown>|null; }
export function validateSpatialStars(raw:unknown):CatalogStar3D[] {
  if(!Array.isArray(raw))throw new Error('三维恒星目录不是数组');
  const ids=new Set<string>();
  return raw.filter((value:any):value is CatalogStar3D=>{
    if(!value||typeof value.id!=='string'||ids.has(value.id)||typeof value.name!=='string'||typeof value.sourceId!=='string')return false;
    if(!Array.isArray(value.positionAU)||value.positionAU.length!==3||!value.positionAU.every(Number.isFinite))return false;
    if(!Number.isFinite(value.distancePc)||value.distancePc<=0||value.distancePc>=99999||!Number.isFinite(value.absoluteMagnitude)||!Number.isFinite(value.bv))return false;
    const expected=value.distancePc*PARSEC_AU,length=Math.hypot(...value.positionAU);
    if(!(length>0)||Math.abs(length/expected-1)>1e-5)return false;
    ids.add(value.id);return true;
  });
}
export async function loadSpatialCatalog(fetcher:typeof fetch=fetch,timeoutMs=12000):Promise<SpatialCatalog>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const request=(async()=>{const response=await fetcher('./data/space-stars.json',{signal:controller.signal});if(!response.ok)throw new Error(`星表HTTP${response.status}`);const raw=await response.json();const stars=validateSpatialStars(raw.stars);if(!stars.length)throw new Error('没有有效的有限距离恒星');return {stars,description:`${stars.length.toLocaleString()} 颗有限距离目录星 · ${raw.catalog?.name??'目录'} ${raw.catalog?.version??''} · J2000固定历元`,warning:null,metadata:raw.catalog??null};})();
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('三维星表载入超时'));},timeoutMs);});
 try{return await Promise.race([request,timeout]);}catch(error){return {stars:[],description:'太阳系可用 · 三维恒星暂不可用',warning:`${error instanceof Error?error.message:String(error)}；未用虚构星点替代。`,metadata:null};}finally{if(timer)clearTimeout(timer);}
}
