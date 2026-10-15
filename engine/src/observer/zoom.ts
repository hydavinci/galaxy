/** One optical zoom range for input, projection, surface rendering and overlays.
 * 0.36 arcsec vertical FOV lets even ~2 arcsec Neptune exceed the viewport.
 * This changes the camera only; all physical apparent diameters remain intact. */
export const MIN_FOV_DEG = 0.0001;
export const MAX_FOV_DEG = 110;
export const INSPECTION_FRACTION = 0.45;
export function clampFov(value:number):number {
  return Math.min(MAX_FOV_DEG,Math.max(MIN_FOV_DEG,value));
}
export function tanHalfFov(value:number):number { return Math.tan(clampFov(value)*Math.PI/360); }
/** A physical disk occupies 45% of the shorter viewport dimension, at any aspect. */
export function inspectionFov(diameterRad:number,width=1,height=1):number {
  const fraction=INSPECTION_FRACTION*Math.min(1,Math.max(1,width)/Math.max(1,height));
  return clampFov(2*Math.atan(Math.tan(diameterRad/2)/fraction)*180/Math.PI);
}
export function formatFov(degrees:number):string {
  if(degrees>=1)return `${degrees.toFixed(degrees<10?2:1)}°`;
  if(degrees>=1/60)return `${(degrees*60).toFixed(2)}′`;
  return `${(degrees*3600).toFixed(2)}″`;
}
