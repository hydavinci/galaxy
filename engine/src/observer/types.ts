// Shared contract: J2000 catalog coordinates; angles in degrees unless marked otherwise.
// Horizon coordinates: x=east, y=up, z=south (north = -Z), azimuth N=0°, E=90°.
export type Vec3 = [number, number, number];
export interface ObserverLocation { name: string; latitude: number; longitude: number; elevation: number; timezone: string; }
export interface CameraState { azimuthDeg: number; altitudeDeg: number; fovDeg: number; }
export type SkyMode = 'visual' | 'enhanced';
export interface SkySettings { atmosphere: boolean; ground: boolean; constellations: boolean; grid: boolean; labels: boolean; milkyWay: boolean; refraction: boolean; lightPollution: number; mode: SkyMode; }
export interface SkyBody {
  id: string; name: string; color: string;
  raRad: number; decRad: number; // topocentric J2000 equatorial
  azimuthDeg: number; altitudeDeg: number; apparentAltitudeDeg: number;
  direction: Vec3; // geometric horizontal unit vector
  distanceAU: number; angularDiameterRad: number; magnitude: number; illuminatedFraction: number;
  sunDirection: Vec3; // unit target->Sun direction in horizontal frame, physical distances respected
}
export interface SkyState {
  date: Date; location: ObserverLocation;
  equatorialToHorizontal: Float32Array; // column-major mat4: engine J2000 [cos dec cos ra, sin dec, cos dec sin ra] -> horizon
  bodies: SkyBody[]; sunAltitudeDeg: number; moonPhaseDeg: number;
}
export interface CatalogStar { id: string; name: string; nameZh?: string; raRad: number; decRad: number; magnitude: number; bv?: number; }
export interface ProjectedPoint { x: number; y: number; visible: boolean; altitudeDeg: number; azimuthDeg: number; }
export interface RenderStats { catalogCount: number; hipsTiles: number; hipsLoading: number; fps: number; status: string; textures?: ReturnType<import('./planet-textures').PlanetTextureManager['getStats']>; }
