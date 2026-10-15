/** Small change-only DOM writes; values stay literal text, never HTML. */
export function patchText(node:Node,value:string):void {if(node.textContent!==value)node.textContent=value;}
export function patchHidden(node:HTMLElement,hidden:boolean):void {if(node.hidden!==hidden)node.hidden=hidden;}
export function patchAttribute(node:Element,name:string,value:string):void {if(node.getAttribute(name)!==value)node.setAttribute(name,value);}
interface FactRow {row:HTMLElement;term:HTMLElement;value:HTMLElement;}
/** Preserve row identity while telemetry changes; structure changes only when
 * the actual field labels/order change, not at every periodic UI refresh. */
export class FactList {
 private fields:FactRow[]=[];
 constructor(private readonly root:HTMLElement){}
 update(rows:readonly (readonly [string,string])[]):boolean {
  let structure=false;
  if(rows.length!==this.fields.length||rows.some((r,i)=>this.fields[i]?.term.textContent!==r[0])){
   const d=this.root.ownerDocument;this.fields=rows.map(([label])=>{const row=d.createElement('div'),term=d.createElement('dt'),value=d.createElement('dd');row.className='fact-row';term.textContent=label;row.append(term,value);return{row,term,value};});
   this.root.replaceChildren(...this.fields.map(f=>f.row));structure=true;
  }
  rows.forEach((r,i)=>patchText(this.fields[i].value,r[1]));return structure;
 }
 dispose():void {this.fields=[];this.root.replaceChildren();}
}
