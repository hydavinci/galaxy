import type { SkySettings } from './types';
import { inspectionFov } from './zoom';
/** Whole celestial sphere: observers still determine parallax/orientation, but
 * terrestrial occlusion, airglow/extinction and refraction never hide a target. */
export function allSkySettings(settings: SkySettings): SkySettings {
  return { ...settings, ground:false, atmosphere:false, refraction:false };
}
/** Help unresolved planets remain findable, without enlarging physical disks or
 * changing the ephemeris/photometry reported in the information panel. */
export function planetLocatorMagnitude(physicalMagnitude: number): number {
  return Math.min(physicalMagnitude, 2.0);
}
export const bodyInspectionFov = inspectionFov;
