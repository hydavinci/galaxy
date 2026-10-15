import { assetUrl } from './assets';
export interface RawNamedStar {name:string;ra:number;dec:number;mag:number;bv?:number;}
/** Star names are optional metadata, never a reason to hide a loaded sky forever. */
export async function loadNamedCatalog(fetcher:typeof fetch=fetch,timeoutMs=12000):Promise<{data:RawNamedStar[];warning:string|null}> {
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const request=(async()=>{
    const response=await fetcher(assetUrl('./data/named-stars.json'),{signal:controller.signal});
    if(!response.ok)throw new Error(`星名目录 HTTP ${response.status}`);
    const raw:unknown=await response.json();
    if(!Array.isArray(raw))throw new Error('星名目录格式错误');
    return raw.filter((s:any):s is RawNamedStar=>!!s&&typeof s.name==='string'&&s.name.length<100&&s.name!=='Sol'&&Number.isFinite(s.ra)&&s.ra>=0&&s.ra<=Math.PI*2&&Number.isFinite(s.dec)&&Math.abs(s.dec)<=Math.PI/2&&Number.isFinite(s.mag)&&s.mag>-5);
  })();
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('星名目录加载超时'));},timeoutMs);});
  try {return {data:await Promise.race([request,timeout]),warning:null};}
  catch(error){return {data:[],warning:`${error instanceof Error?error.message:String(error)}；仍可查看星空、搜索行星与星座。`};}
  finally {if(timer)clearTimeout(timer);}
}
