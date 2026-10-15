import { AU_KM } from './types';

/** Four independent ticks surround the rendered physical globe, not its center.
 * CSS pixels throughout; fixed stroke length/gap are never scaled with DPR.
 * Unknown-radius catalogue stars keep a small hollow locator without inventing
 * a stellar surface radius. There is NO inward viewport clamp at extreme zoom:
 * offscreen edges are clipped/hidden instead of painted over the globe. */
export const FOCUS_LIMB_GAP_CSS_PX = 6;
export const FOCUS_TICK_LENGTH_CSS_PX = 10;
export const MIN_FOCUS_RADIUS_CSS_PX = 8;
export type FocusEdge = 'top'|'right'|'bottom'|'left';
export const FOCUS_EDGES:readonly FocusEdge[] = ['top','right','bottom','left'];
export function focusSizeCssPixels(radiusKm:number|null,distanceAU:number,fovDeg:number,width:number,height:number):number {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return 0;
  let radius=MIN_FOCUS_RADIUS_CSS_PX;
  if(radiusKm!==null){
    if(!Number.isFinite(radiusKm)||radiusKm<=0||!Number.isFinite(distanceAU)||distanceAU<=0||!Number.isFinite(fovDeg)||fovDeg<=0||fovDeg>=179)return 0;
    const ratio=radiusKm/AU_KM/distanceAU;
    if(!(ratio>0&&ratio<1))return 0;
    const projectedRadius=height*ratio/(2*Math.sqrt((1-ratio)*(1+ratio))*Math.tan(fovDeg*Math.PI/360));
    if(!Number.isFinite(projectedRadius))return 0;
    radius=Math.max(MIN_FOCUS_RADIUS_CSS_PX,projectedRadius);
  }
  return 2*(radius+FOCUS_LIMB_GAP_CSS_PX+FOCUS_TICK_LENGTH_CSS_PX);
}
export interface FocusTick { edge:FocusEdge; x:number; y:number; width:number; height:number; visible:boolean; }
/** Independent edge visibility permits a partially offscreen planet center.
 * Do not drag its invisible ticks inward to the viewport or fake a center mark. */
export function focusTicks(x:number,y:number,size:number,width:number,height:number):FocusTick[] {
  if(![x,y,size,width,height].every(Number.isFinite)||size<=0||width<=0||height<=0)return [];
  const half=size/2,l=FOCUS_TICK_LENGTH_CSS_PX;
  const ticks:Array<Omit<FocusTick,'visible'>>=[
    {edge:'top',x:x-.5,y:y-half,width:1,height:l},
    {edge:'right',x:x+half-l,y:y-.5,width:l,height:1},
    {edge:'bottom',x:x-.5,y:y+half-l,width:1,height:l},
    {edge:'left',x:x-half,y:y-.5,width:l,height:1},
  ];
  return ticks.map(t=>({...t,visible:t.x<width&&t.y<height&&t.x+t.width>0&&t.y+t.height>0}));
}
