import data from './observation-data.json';
import type {PlanetTextureSources} from '../observer/planet-textures';
export interface ObservationRecord {
  id:string;kind:'global-map'|'observation-photo';title:string;path?:string;imageId?:string;
  sourceUrl:string;imageSourceUrl:string;credit:string;license:string;licenseUrl:string;
  capturedAt:string;processing:string;coverage:string;limitations:string;
  tiers?:Partial<Record<2|4|8,string>>;
}
export const OBSERVATIONS:readonly ObservationRecord[] = (data as {records:ObservationRecord[]}).records;
export function observationMap(id:string):ObservationRecord|undefined {return OBSERVATIONS.find(r=>r.id===id&&r.kind==='global-map');}
export function observationImages(id:string,records:readonly ObservationRecord[]=OBSERVATIONS):ObservationRecord[] {
  const photos=records.filter(r=>r.id===id&&r.kind==='observation-photo'),maps=records.filter(r=>r.id===id&&r.kind==='global-map');
  return [...photos,...maps];
}
export function observationImage(id:string,records:readonly ObservationRecord[]=OBSERVATIONS):ObservationRecord|undefined {return observationImages(id,records)[0];}
/** Missing IDs are intentionally not inherited from historical artistic maps. */
export const OBSERVATION_MAP_SOURCES:PlanetTextureSources=Object.fromEntries(OBSERVATIONS.filter(r=>r.kind==='global-map'&&r.tiers?.[2]).map(r=>[r.id,r.tiers!]));
export function surfaceEvidence(id:string,stellar=false):string {
  if(stellar)return '无可用表面影像 · 仅尺寸/颜色示意，非实拍';
  const record=observationMap(id);
  if(record&&id==='moon')return 'LRO观测合成 · 含极区替代与少量源修补，非实时';
  if(record&&id==='earth')return '2004年8月观测合成 · 无实时云层，深海统一配色';
  return record?'三维表面：观测数据合成贴图，非实时影像':'无已核验全球贴图 · 三维仅几何/颜色示意';
}
/** One on-demand observation image, never used as a globe material. No remote
 * hotlinking, stale target picture, automatic gallery downloads or extra RAF. */
export class ObservationPanel {
  private current='';private generation=0;private image:HTMLImageElement|null=null;private timer=0;private disposed=false;
  private choices:ObservationRecord[]=[];private index=0;private activated=false;
  private readonly navigation:HTMLElement;private readonly previous:HTMLButtonElement;private readonly next:HTMLButtonElement;private readonly chooser:HTMLSelectElement;private readonly counter:HTMLElement;
  private readonly title:HTMLElement;private readonly detail:HTMLElement;private readonly imageHost:HTMLElement;
  private readonly status:HTMLElement;private readonly button:HTMLButtonElement;private readonly link:HTMLAnchorElement;
  constructor(private readonly root:HTMLElement,private readonly records:readonly ObservationRecord[]=OBSERVATIONS){
    const d=root.ownerDocument;this.title=d.createElement('strong');this.detail=d.createElement('p');this.imageHost=d.createElement('div');this.imageHost.className='observation-photo-host';this.status=d.createElement('p');this.status.setAttribute('role','status');this.button=d.createElement('button');this.button.type='button';this.button.textContent='查看观测影像';this.link=d.createElement('a');this.link.target='_blank';this.link.rel='noopener noreferrer';this.link.textContent='原始来源与说明';
    this.button.dataset.observationAction='load';
    this.navigation=d.createElement('div');this.navigation.className='observation-gallery-nav';this.navigation.setAttribute('role','group');this.navigation.setAttribute('aria-label','切换观测影像');
    this.previous=d.createElement('button');this.previous.type='button';this.previous.textContent='‹';this.previous.title='上一张';this.previous.setAttribute('aria-label','上一张观测影像');this.previous.dataset.observationAction='previous';this.previous.onclick=()=>this.choose(this.index-1);
    this.next=d.createElement('button');this.next.type='button';this.next.textContent='›';this.next.title='下一张';this.next.setAttribute('aria-label','下一张观测影像');this.next.dataset.observationAction='next';this.next.onclick=()=>this.choose(this.index+1);
    this.chooser=d.createElement('select');this.chooser.setAttribute('aria-label','选择观测影像');this.chooser.dataset.observationAction='select';this.chooser.onchange=()=>{const value=this.chooser.value;if(!/^\d+$/.test(value)){this.chooser.value=String(this.index);return;}this.choose(Number(value));};
    this.counter=d.createElement('span');this.counter.className='observation-gallery-count';this.counter.setAttribute('aria-live','polite');
    this.navigation.append(this.previous,this.chooser,this.next,this.counter);
    root.append(this.title,this.button,this.navigation,this.imageHost,this.status,this.detail,this.link);
  }
  show(id:string,visible:boolean):void {
    if(this.disposed)return;
    if(!visible){this.root.hidden=true;if(this.current){this.clear();this.current='';}return;}
    this.root.hidden=false;if(this.current===id)return;this.clear();this.current=id;this.choices=observationImages(id,this.records);this.index=0;this.activated=false;this.chooser.replaceChildren();
    for(const [i,record] of this.choices.entries()){const option=this.root.ownerDocument.createElement('option');option.value=String(i);option.textContent=`${i+1}. ${record.title}${record.kind==='global-map'?'〔拼接地图〕':''}`;this.chooser.append(option);}
    this.present();
  }
  private choose(index:number):void {
    if(this.disposed||this.root.hidden||!Number.isInteger(index)||index<0||index>=this.choices.length||index===this.index)return;
    this.clearImage();this.index=index;this.present();if(this.activated)this.load(this.choices[index]);
  }
  private present():void {
    const record=this.choices[this.index];this.root.dataset.observationCount=String(this.choices.length);this.root.dataset.observationIndex=String(this.index);
    this.navigation.hidden=this.choices.length<2;this.previous.disabled=this.index<=0;this.next.disabled=this.index>=this.choices.length-1;this.chooser.value=String(this.index);this.counter.textContent=`${this.choices.length?this.index+1:0} / ${this.choices.length}`;
    this.title.textContent=record?'实际观测影像':'观测影像资料';
    if(!record){this.detail.textContent='尚无已核验、可展示的该天体影像；不以合成表面或其他天体的照片替代。';this.button.hidden=true;this.link.hidden=true;this.link.removeAttribute('href');delete this.root.dataset.observationKey;return;}
    this.root.dataset.observationKey=record.imageId??record.path??record.tiers?.[2]??record.title;
    const kind=record.kind==='global-map'?'全球观测数据拼接图（非单次照片）':'观测影像（不作为球面贴图）';
    this.title.textContent=record.title;this.detail.textContent=`${kind}。观测日期：${record.capturedAt}。${record.coverage}；${record.processing}；${record.limitations}。署名：${record.credit}。许可：${record.license}`;
    this.link.hidden=!/^https?:\/\//.test(record.sourceUrl);this.link.href=this.link.hidden?'#':record.sourceUrl;
    this.button.hidden=false;this.button.disabled=false;this.button.onclick=()=>this.load(record);
  }
  private load(record:ObservationRecord):void {
    if(this.disposed||this.root.hidden||this.current!==record.id||this.choices[this.index]!==record)return;
    const src=record.path??record.tiers?.[2];if(!src||!/^\.\/observations\/(photos|maps|gallery)\/[^?#]+$/.test(src))return;
    this.activated=true;this.clearImage();const ticket=this.generation,id=this.current,d=this.root.ownerDocument,img=d.createElement('img');this.image=img;img.alt=`${record.title}；${record.kind==='global-map'?'观测数据拼接图':'实际观测影像'}；${record.capturedAt}`;img.decoding='async';img.referrerPolicy='no-referrer';img.hidden=true;this.imageHost.append(img);this.status.textContent='正在加载观测影像…';this.button.disabled=true;
    let settled=false;
    const current=()=>!settled&&!this.disposed&&ticket===this.generation&&id===this.current&&this.image===img;
    const end=()=>{settled=true;this.root.ownerDocument.defaultView?.clearTimeout(this.timer);this.timer=0;img.onload=img.onerror=null;};
    const fail=()=>{if(!current())return;end();img.removeAttribute('src');img.hidden=true;this.status.textContent='观测影像暂未载入，可重试或打开原始来源。';this.button.disabled=false;};
    img.onload=()=>{if(!current())return;if(!(img.naturalWidth>0&&img.naturalHeight>0)){fail();return;}end();img.hidden=false;this.status.textContent='观测影像已载入；拍摄时间及处理说明见下方。';this.button.disabled=false;};img.onerror=fail;this.timer=this.root.ownerDocument.defaultView!.setTimeout(fail,15000);img.src=src;
  }
  private clearImage(){this.generation++;this.root.ownerDocument.defaultView?.clearTimeout(this.timer);this.timer=0;if(this.image){this.image.onload=this.image.onerror=null;this.image.removeAttribute('src');this.image.remove();this.image=null;}this.imageHost.replaceChildren();this.status.textContent='';}
  private clear(){this.clearImage();this.button.onclick=null;this.button.disabled=false;this.choices=[];this.activated=false;}
  dispose(){if(this.disposed)return;this.clear();this.disposed=true;this.previous.onclick=this.next.onclick=null;this.chooser.onchange=null;this.root.replaceChildren();}
}
