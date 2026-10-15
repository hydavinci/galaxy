import {patchText,patchHidden,patchAttribute} from './dom-patches';
export type SpacecraftCategory='probe'|'rover'|'telescope'|'sample-return';
export interface SpacecraftRecord {
 id:string;name:string;nameEn:string;agency:string;category:SpacecraftCategory;launchDate:string;missionType:string;
 targetNames:string[];relatedBodyIds:string[];summary:string;instruments:string[];achievements:string[];
 milestones:Array<{date:string;label:string}>;sources:Array<{label:string;url:string}>;limitations:string;
}
export interface SpacecraftData {schemaVersion:number;verifiedOn:string;notice:string;records:SpacecraftRecord[];}
export const SPACECRAFT_CATEGORIES:Record<SpacecraftCategory,string>={probe:'探测器',rover:'巡视器',telescope:'空间望远镜','sample-return':'采样返回'};
const BODIES:Record<string,string>={sun:'太阳',mercury:'水星',venus:'金星',earth:'地球',moon:'月球',mars:'火星',jupiter:'木星',saturn:'土星',uranus:'天王星',neptune:'海王星'};
const normalized=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-_’'·]/g,'');
export function safeSpacecraftSource(url:string):boolean {try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
export function filterSpacecraft(records:readonly SpacecraftRecord[],query='',category='all',body='all'):SpacecraftRecord[]{
 const q=normalized(query.slice(0,120));return records.filter(r=>(category==='all'||r.category===category)&&(body==='all'||r.relatedBodyIds.includes(body))&&(!q||normalized([r.name,r.nameEn,r.agency,r.missionType,...r.targetNames,...r.instruments].join(' ')).includes(q)));
}
/** Bundled historical information only: no fetch, spacecraft coordinates, timers,
 * images, scene objects, animation loops or changes to simulation/navigation. */
export interface SpacecraftPositionInfo {text:string;canShow:boolean;canVisit:boolean;visitLabel:string;sourceUrl?:string;}
export interface SpacecraftSpatialActions {showPosition:(id:string,availablePeriod:boolean)=>void;requestPositions:()=>void;}
export class SpacecraftLibrary {
 private disposed=false;private positionInfo=new Map<string,SpacecraftPositionInfo>();
 private spatialNodes=new Map<string,{status:HTMLElement;show:HTMLButtonElement;visit:HTMLButtonElement;source:HTMLAnchorElement}>();
 private spatialRetry:HTMLButtonElement|undefined;private spatialStatus:HTMLElement|undefined;
 private readonly search:HTMLInputElement;private readonly category:HTMLSelectElement;private readonly body:HTMLSelectElement;
 private readonly resetButton:HTMLButtonElement;private readonly count:HTMLElement;private readonly results:HTMLElement;
 constructor(private readonly root:HTMLElement,private readonly data:SpacecraftData,private readonly spatial?:SpacecraftSpatialActions){
  const d=root.ownerDocument,make=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const e=d.createElement(tag);if(text)e.textContent=text;return e;};
  const toolbar=make('div');toolbar.className='spacecraft-filters';
  const searchLabel=make('label','搜索任务');this.search=make('input');this.search.type='search';this.search.maxLength=120;this.search.placeholder='名称、机构、目标或仪器';this.search.autocomplete='off';this.search.dataset.spacecraftAction='search';this.search.setAttribute('aria-label','搜索航天器任务');searchLabel.append(this.search);
  const categoryLabel=make('label','任务类别');this.category=make('select');this.category.dataset.spacecraftAction='category';this.category.setAttribute('aria-label','筛选任务类别');categoryLabel.append(this.category);
  const bodyLabel=make('label','相关天体');this.body=make('select');this.body.dataset.spacecraftAction='body';this.body.setAttribute('aria-label','筛选相关天体');bodyLabel.append(this.body);
  const option=(select:HTMLSelectElement,value:string,label:string)=>{const e=make('option',label);e.value=value;select.append(e);};option(this.category,'all','全部类别');for(const [value,label]of Object.entries(SPACECRAFT_CATEGORIES))option(this.category,value,label);
  option(this.body,'all','全部任务');for(const [id,name]of Object.entries(BODIES))if(this.relatedCount(id))option(this.body,id,name);
  this.resetButton=make('button','重置筛选');this.resetButton.type='button';this.resetButton.dataset.spacecraftAction='reset';
  toolbar.append(searchLabel,categoryLabel,bodyLabel,this.resetButton);
  const note=make('p',`${spatial?'任务资料与位置数据分别核验；轨迹为有界星历采样，历史着陆点不代表当前位置，不提供实时遥测。':data.notice} 资料核对：${data.verifiedOn}；核对日期不代表实时任务状态。`);note.className='spacecraft-notice';
  this.count=make('p');this.count.className='spacecraft-count';this.count.setAttribute('role','status');this.count.setAttribute('aria-live','polite');this.results=make('div');this.results.className='spacecraft-results';this.results.dataset.spacecraftResults='';
  root.append(note,toolbar,this.count);
  if(spatial){this.spatialStatus=make('p','位置数据按需载入；不代表实时遥测。');this.spatialStatus.className='spacecraft-position-status';this.spatialStatus.setAttribute('role','status');this.spatialRetry=make('button','载入 / 重试位置数据');this.spatialRetry.type='button';this.spatialRetry.dataset.spacecraftAction='load-positions';this.spatialRetry.onclick=()=>{if(!this.disposed)spatial.requestPositions();};root.append(this.spatialStatus,this.spatialRetry);}
  root.append(this.results);
  this.search.oninput=()=>this.render();this.category.onchange=()=>this.render();this.body.onchange=()=>this.render();this.resetButton.onclick=()=>{this.reset();this.search.focus({preventScroll:true});};this.reset();
 }
 setPositionInfo(values:ReadonlyMap<string,SpacecraftPositionInfo>,status:string):void {if(this.disposed)return;this.positionInfo=new Map(values);if(this.spatialStatus)patchText(this.spatialStatus,status);this.updateSpatial();}
 private updateSpatial():void {for(const [id,nodes]of this.spatialNodes){const info=this.positionInfo.get(id);patchText(nodes.status,info?.text??'尚未载入位置与轨迹数据');if(nodes.show.disabled===!!info?.canShow)nodes.show.disabled=!info?.canShow;if(nodes.visit.disabled===!!info?.canVisit)nodes.visit.disabled=!info?.canVisit;patchText(nodes.visit,info?.visitLabel??'查看可用时段');patchHidden(nodes.source,!info?.sourceUrl||!safeSpacecraftSource(info.sourceUrl));if(!nodes.source.hidden)patchAttribute(nodes.source,'href',info!.sourceUrl!);else if(nodes.source.hasAttribute('href'))nodes.source.removeAttribute('href');}}
 relatedCount(id:string):number{return this.data.records.filter(r=>r.relatedBodyIds.includes(id)).length;}
 reset(body='all'):void {if(this.disposed)return;this.search.value='';this.category.value='all';this.body.value=body in BODIES&&this.relatedCount(body)?body:'all';this.render();}
 focus():void {if(!this.disposed)this.search.focus({preventScroll:true});}
 private render():void {
  if(this.disposed)return;let category=this.category.value,body=this.body.value;
  if(category!=='all'&&!(category in SPACECRAFT_CATEGORIES)){category='all';this.category.value='all';}
  if(body!=='all'&&!(body in BODIES)){body='all';this.body.value='all';}
  const records=filterSpacecraft(this.data.records,this.search.value,category,body);this.root.dataset.spacecraftCount=String(records.length);this.root.dataset.spacecraftBody=body;
  this.count.textContent=`显示 ${records.length} / ${this.data.records.length} 项任务${body!=='all'?` · ${BODIES[body]}相关`:''}`;this.results.replaceChildren();this.spatialNodes.clear();
  const d=this.root.ownerDocument,make=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const e=d.createElement(tag);if(text)e.textContent=text;return e;};
  if(!records.length){const empty=make('p','没有匹配的航天器任务。试试其他名称，或重置筛选。');empty.className='spacecraft-empty';this.results.append(empty);return;}
  for(const record of records){
   const article=make('article');article.className='spacecraft-card';article.dataset.spacecraftId=record.id;
   const detail=make('details'),summary=make('summary'),heading=make('span'),name=make('strong',record.name),english=make('small',record.nameEn),badge=make('span',SPACECRAFT_CATEGORIES[record.category]);badge.className='spacecraft-badge';heading.append(name,english);summary.append(heading,badge);
   const brief=make('p',`${record.launchDate} 发射 · ${record.targetNames.join(' / ')}`);brief.className='spacecraft-brief';summary.append(brief);detail.append(summary);
   const content=make('div');content.className='spacecraft-content';
   if(this.spatial){const block=make('section');block.className='spacecraft-spatial';const status=make('p'),show=make('button','查看所选时刻的位置'),visit=make('button','查看可用时段'),source=make('a','位置数据来源 ↗');show.type=visit.type='button';show.dataset.spacecraftAction='show-position';visit.dataset.spacecraftAction='visit-period';show.onclick=()=>{if(!this.disposed)this.spatial?.showPosition(record.id,false);};visit.onclick=()=>{if(!this.disposed)this.spatial?.showPosition(record.id,true);};source.target='_blank';source.rel='noopener noreferrer';block.append(status,show,visit,source);content.append(block);this.spatialNodes.set(record.id,{status,show,visit,source});}
   content.append(make('p',record.summary));const facts=make('dl');
   for(const [label,value]of [['机构 / 团队',record.agency],['发射日期',record.launchDate],['任务类型',record.missionType],['目标 / 研究对象',record.targetNames.join('、')]]){const row=make('div');row.className='spacecraft-fact';row.append(make('dt',label),make('dd',value));facts.append(row);}content.append(facts);
   const list=(title:string,values:string[])=>{content.append(make('h3',title));const ul=make('ul');for(const text of values)ul.append(make('li',text));content.append(ul);};
   list('代表性仪器',record.instruments);content.append(make('h3','重要事件'));const timeline=make('ol');timeline.className='spacecraft-timeline';
   for(const event of record.milestones){const li=make('li'),time=make('time',event.date);time.dateTime=event.date;li.append(time,make('span',event.label));timeline.append(li);}content.append(timeline);list('任务成果',record.achievements);
   const limits=make('p',record.limitations);limits.className='spacecraft-limits';content.append(limits);const sources=make('div');sources.className='spacecraft-sources';sources.setAttribute('aria-label',`${record.name}官方资料来源`);
   for(const source of record.sources){if(!safeSpacecraftSource(source.url))continue;const a=make('a',source.label+' ↗');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';sources.append(a);}content.append(sources);detail.append(content);article.append(detail);this.results.append(article);
  }
  this.updateSpatial();
 }
 dispose():void {if(this.disposed)return;this.disposed=true;this.search.oninput=this.category.onchange=this.body.onchange=this.resetButton.onclick=null;if(this.spatialRetry)this.spatialRetry.onclick=null;this.spatialNodes.clear();this.positionInfo.clear();this.root.replaceChildren();delete this.root.dataset.spacecraftCount;delete this.root.dataset.spacecraftBody;}
}
