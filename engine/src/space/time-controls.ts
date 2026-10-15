/** Fine-grained spatial-view playback presets. This controls simulation rate,
 * not the scientific clock's integration timestep or the camera's flight speed. */
export const FORWARD_TIME_SPEEDS:readonly number[] = Object.freeze([1,2,5,10,20,30,60,120,300,600,1800,3600,7200,14400,21600,43200,86400]);
export const SPACE_TIME_SPEEDS:readonly number[] = Object.freeze([...FORWARD_TIME_SPEEDS].reverse().map(n=>-n).concat([0],FORWARD_TIME_SPEEDS));
export function nextSpaceTimeSpeed(speed:number,direction:number):number {
  if(!Number.isFinite(speed))speed=1;
  if(!Number.isFinite(direction)||direction===0)return speed;
  if(direction>0)return SPACE_TIME_SPEEDS.find(n=>n>speed)??SPACE_TIME_SPEEDS[SPACE_TIME_SPEEDS.length-1];
  for(let i=SPACE_TIME_SPEEDS.length-1;i>=0;i--)if(SPACE_TIME_SPEEDS[i]<speed)return SPACE_TIME_SPEEDS[i];
  return SPACE_TIME_SPEEDS[0];
}
export function spaceTimeText(speed:number):string {
  return speed===0?'暂停':`${speed<0?'−':''}${Math.abs(speed).toLocaleString('zh-CN',{maximumFractionDigits:2})}×`;
}
export function spaceTimeDescription(speed:number):string {
  if(!speed)return '时间已暂停';
  const value=Math.abs(speed),direction=speed<0?'倒退':'前进';
  const unit=value>=86400?`${value/86400}天`:value>=3600?`${value/3600}小时`:value>=60?`${value/60}分钟`:`${value}秒`;
  return `现实1秒，模拟${direction}${unit}；倍率${spaceTimeText(speed)}`;
}
