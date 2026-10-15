import * as AstronomyModule from 'astronomy-engine';
// v2.1.19's ESM export lives in a package without type=module. Native Vite
// provides a namespace; tsx/Node may wrap it as default. Support both without
// changing the dependency or importing a Node-only API into the browser.
const Astronomy: typeof AstronomyModule = Reflect.get(AstronomyModule, 'default') ?? AstronomyModule;
const { Body, Equator, Illumination, KM_PER_AU, MoonPhase, Observer,
  ObserverVector, Refraction, Rotation_EQJ_HOR } = Astronomy;
import type { CatalogStar, ObserverLocation, SkyBody, SkyState, Vec3 } from './types';

const DEG = Math.PI / 180;
const MIN_TIME = Date.UTC(1900, 0, 1);
const MAX_TIME = Date.UTC(2101, 0, 1) - 1;

export const DEFAULT_LOCATION: ObserverLocation = Object.freeze({
  name: '苏州', latitude: 31.2989, longitude: 120.5853, elevation: 10, timezone: 'Asia/Shanghai',
});

/** Longitude is east-positive; elevation is metres above mean sea level. */
export const LOCATIONS: readonly ObserverLocation[] = Object.freeze([
  DEFAULT_LOCATION,
  Object.freeze({ name: '北京', latitude: 39.9042, longitude: 116.4074, elevation: 44, timezone: 'Asia/Shanghai' }),
  Object.freeze({ name: '乌鲁木齐（北京时间）', latitude: 43.8256, longitude: 87.6168, elevation: 800, timezone: 'Asia/Shanghai' }),
  Object.freeze({ name: '格林尼治', latitude: 51.4769, longitude: 0, elevation: 46, timezone: 'Europe/London' }),
  Object.freeze({ name: '赤道 · UTC', latitude: 0, longitude: 0, elevation: 0, timezone: 'UTC' }),
  Object.freeze({ name: '纽约', latitude: 40.7128, longitude: -74.006, elevation: 10, timezone: 'America/New_York' }),
  Object.freeze({ name: '悉尼', latitude: -33.8688, longitude: 151.2093, elevation: 58, timezone: 'Australia/Sydney' }),
  Object.freeze({ name: '特罗姆瑟', latitude: 69.6492, longitude: 18.9553, elevation: 10, timezone: 'Europe/Oslo' }),
]);

const BODIES: ReadonlyArray<{ body: AstronomyModule.Body; name: string; color: string; radiusKm: number }> = [
  { body: Body.Sun, name: '太阳', color: '#fff2bd', radiusKm: 695700 },
  { body: Body.Moon, name: '月球', color: '#e3e6e9', radiusKm: 1737.4 },
  { body: Body.Mercury, name: '水星', color: '#b4aaa0', radiusKm: 2439.7 },
  { body: Body.Venus, name: '金星', color: '#ffedbf', radiusKm: 6051.8 },
  { body: Body.Mars, name: '火星', color: '#e8926e', radiusKm: 3396.19 },
  { body: Body.Jupiter, name: '木星', color: '#e4cba4', radiusKm: 71492 },
  { body: Body.Saturn, name: '土星', color: '#e5d8af', radiusKm: 60268 },
  { body: Body.Uranus, name: '天王星', color: '#a9e6e6', radiusKm: 25559 },
  { body: Body.Neptune, name: '海王星', color: '#789bed', radiusKm: 24764 },
];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  if (!(length > 0) || !Number.isFinite(length)) throw new RangeError('Invalid direction vector');
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function validateDate(date: Date): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new RangeError('日期无效 / Invalid date');
  if (date.getTime() < MIN_TIME || date.getTime() > MAX_TIME) {
    throw new RangeError('支持的观测日期为 UTC 1900-01-01 至 2100-12-31');
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function zonedFormatter(timezone: string): Intl.DateTimeFormat {
  if (typeof timezone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timezone)) {
    throw new RangeError('需要有效的 IANA 时区名称（如 Asia/Shanghai 或 UTC）');
  }
  let formatter = formatters.get(timezone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      });
    } catch {
      throw new RangeError(`无效的 IANA 时区 / Invalid timezone: ${timezone}`);
    }
    if (formatters.size >= 64) formatters.clear();
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** Returns a validated copy, or throws RangeError. Never coerces strings into numbers. */
export function validateLocation(location: ObserverLocation): ObserverLocation {
  if (!location || typeof location !== 'object') throw new RangeError('观测地点无效');
  const { latitude, longitude, elevation, timezone, name } = location;
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new RangeError('地点名称需为 1–120 个字符');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new RangeError('纬度需在 -90 至 90 度');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new RangeError('经度需在 -180 至 180 度');
  if (!Number.isFinite(elevation) || elevation < -500 || elevation > 10000) throw new RangeError('海拔需在 -500 至 10000 米');
  zonedFormatter(timezone);
  return { name: name.trim(), latitude, longitude, elevation, timezone };
}

type CivilTime = [number, number, number, number, number, number];
function civilParts(date: Date, formatter: Intl.DateTimeFormat): CivilTime {
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(p => p.type === type)!.value);
  return [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
}
function civilEpoch([y, m, d, h, min, sec]: CivilTime): number {
  return Date.UTC(y, m - 1, d, h, min, sec);
}
function civilString(parts: CivilTime): string {
  const [y, m, d, h, min, sec] = parts.map((v, i) => String(v).padStart(i === 0 ? 4 : 2, '0'));
  return `${y}-${m}-${d}T${h}:${min}:${sec}`;
}

/** HTML datetime-local value in the requested zone; truncates milliseconds, never uses host TZ. */
export function formatLocalDateTime(date: Date, timezone: string): string {
  validateDate(date);
  return civilString(civilParts(date, zonedFormatter(timezone)));
}

/**
 * Parse a wall clock without host-timezone dependence. Seconds are optional.
 * A DST gap or repeated time throws: never silently chooses an offset.
 * JavaScript/Intl has no leap-second representation; seconds must be 00..59.
 */
export function parseLocalDateTime(value: string, timezone: string): Date {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new RangeError('日期格式需为 YYYY-MM-DDTHH:mm[:ss]，不附带 UTC 偏移');
  const civil: CivilTime = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)];
  const wallEpoch = civilEpoch(civil);
  const normalized = new Date(wallEpoch);
  if (civil[0] < 1899 || civil[0] > 2101 || civil[1] < 1 || civil[1] > 12 || civil[2] < 1 ||
      civil[3] > 23 || civil[4] > 59 || civil[5] > 59 || normalized.getUTCFullYear() !== civil[0] ||
      normalized.getUTCMonth() + 1 !== civil[1] || normalized.getUTCDate() !== civil[2]) {
    throw new RangeError('当地日期不存在或远离支持范围（最终按 UTC 1900–2100 验证）');
  }
  const formatter = zonedFormatter(timezone);
  // Sample both sides of any nearby IANA transition, including non-hour DST and
  // date-line changes. Preserve historical second-resolution timezone offsets.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = wallEpoch + hours * 3600000;
    offsets.add(civilEpoch(civilParts(new Date(instant), formatter)) - instant);
  }
  const expected = civilString(civil);
  const candidates = [...offsets]
    .map(offset => new Date(wallEpoch - offset))
    .filter(date => civilString(civilParts(date, formatter)) === expected);
  if (candidates.length === 0) throw new RangeError('当地时间不存在（夏令时跳时或时区变更）/ nonexistent local time');
  if (candidates.length > 1) throw new RangeError('当地时间有歧义（夏令时重复时段），请选择其他时间 / ambiguous local time');
  validateDate(candidates[0]);
  return candidates[0];
}

/** Azimuth north=0, east=90; engine horizon north=-Z, east=+X, zenith=+Y. */
export function horizontalDirection(azimuthDeg: number, altitudeDeg: number): Vec3 {
  const az = azimuthDeg * DEG;
  const alt = altitudeDeg * DEG;
  const c = Math.cos(alt);
  return [c * Math.sin(az), Math.sin(alt), -c * Math.cos(az)];
}

/** Standard-atmosphere visual approximation, not local pressure/temperature data. */
export function refractedAltitude(altitudeDeg: number): number {
  if (!Number.isFinite(altitudeDeg) || altitudeDeg < -90 || altitudeDeg > 90) throw new RangeError('Invalid altitude');
  // The analytic approximation becomes slightly negative right at zenith;
  // physical astronomical refraction there is zero, not a downward bend.
  return clamp(altitudeDeg + Math.max(0, Refraction('normal', altitudeDeg)), -90, 90);
}

/** Applies the linear 3x3 part (w=0) of a column-major mat4; normalizes the result. */
export function transformDirection(matrix: Float32Array, vector: Vec3): Vec3 {
  return normalize([
    matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2],
    matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2],
    matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2],
  ]);
}

function horizontal(direction: Vec3, refraction: boolean) {
  const altitudeDeg = Math.asin(clamp(direction[1], -1, 1)) / DEG;
  // At the zenith/nadir azimuth is undefined; choose zero deterministically.
  const azimuthDeg = Math.hypot(direction[0], direction[2]) < 1e-12 ? 0
    : (Math.atan2(direction[0], -direction[2]) / DEG + 360) % 360;
  return { azimuthDeg, altitudeDeg, apparentAltitudeDeg: refraction ? refractedAltitude(altitudeDeg) : altitudeDeg, direction };
}

/**
 * Fixed J2000 catalog star -> horizon. No proper motion/parallax/annual aberration.
 * direction and altitudeDeg ALWAYS remain geometric; when refraction=true only
 * apparentAltitudeDeg changes. For drawing refraction, rebuild the direction via
 * horizontalDirection(azimuthDeg, apparentAltitudeDeg) exactly once.
 */
export function starHorizontal(star: CatalogStar, state: SkyState, refraction = false): {
  azimuthDeg: number; altitudeDeg: number; apparentAltitudeDeg: number; direction: Vec3;
} {
  if (!Number.isFinite(star.raRad) || !Number.isFinite(star.decRad) || Math.abs(star.decRad) > Math.PI / 2) {
    throw new RangeError('Invalid J2000 star coordinates');
  }
  const c = Math.cos(star.decRad);
  return horizontal(transformDirection(state.equatorialToHorizontal,
    [c * Math.cos(star.raRad), Math.sin(star.decRad), c * Math.sin(star.raRad)]), refraction);
}

/**
 * Astronomy Engine EQJ is [RA0, RA90, Dec90]; its HOR is [north, west, up].
 * Convert BOTH bases: engine [RA0, Dec90, RA90] -> [east, up, south].
 * rot[inputAxis][outputAxis] stores columns, not row-major rows. The engine's
 * RA0/Dec90/RA90 basis swaps handedness, so this orthogonal map has det=-1.
 */
function horizonMatrix(date: Date, observer: AstronomyModule.Observer): Float32Array {
  const r = Rotation_EQJ_HOR(date, observer).rot;
  const matrix = new Float32Array(16);
  [0, 2, 1].forEach((sourceAxis, column) => {
    matrix[column * 4] = -r[sourceAxis][1];
    matrix[column * 4 + 1] = r[sourceAxis][2];
    matrix[column * 4 + 2] = -r[sourceAxis][0];
  });
  matrix[15] = 1;
  return matrix;
}

/**
 * Nine topocentric solar-system bodies. J2000 positions have light-time and
 * annual aberration corrections; 'geometric' below means WITHOUT refraction,
 * not an instantaneous Newtonian position. Precession/nutation enter the matrix
 * once. Lighting uses same-time physical AU vectors, not unit-vector subtraction.
 */
export function computeSky(date: Date, location: ObserverLocation): SkyState {
  validateDate(date);
  const safeLocation = validateLocation(location);
  const safeDate = new Date(date.getTime());
  const observer = new Observer(safeLocation.latitude, safeLocation.longitude, safeLocation.elevation);
  const matrix = horizonMatrix(safeDate, observer);
  const observerEqj = ObserverVector(safeDate, observer, false);
  const bodies: SkyBody[] = BODIES.map(({ body, name, color, radiusKm }) => {
    // ofdate=false is crucial: the matrix consumes J2000, not equator-of-date.
    const equator = Equator(body, safeDate, observer, false, true);
    const direction = transformDirection(matrix, [equator.vec.x, equator.vec.z, equator.vec.y]);
    const angles = horizontal(direction, true);
    const illumination = Illumination(body, safeDate);
    const physicalTopocentric: Vec3 = [
      illumination.gc.x - observerEqj.x,
      illumination.gc.y - observerEqj.y,
      illumination.gc.z - observerEqj.z,
    ];
    const physicalDistance = Math.hypot(...physicalTopocentric);
    let sunDirection: Vec3;
    let illuminatedFraction: number;
    if (body === Body.Sun) {
      // The Sun is emissive: target->itself is undefined. This harmless unit
      // placeholder gives a full disk, but a renderer must not shade the Sun.
      sunDirection = [-direction[0], -direction[1], -direction[2]];
      illuminatedFraction = 1;
    } else {
      // hc is Sun->target at this date, in AU and EQJ. Its negative is the
      // physical target->Sun difference. Observer subtraction belongs only in
      // target->observer; translating both target and Sun cancels for lighting.
      const targetToSun = normalize([-illumination.hc.x, -illumination.hc.y, -illumination.hc.z]);
      const observerToTarget = normalize(physicalTopocentric);
      illuminatedFraction = clamp((1 - dot(observerToTarget, targetToSun)) / 2, 0, 1);
      sunDirection = transformDirection(matrix, [targetToSun[0], targetToSun[2], targetToSun[1]]);
    }
    return {
      id: body.toLowerCase(), name, color,
      raRad: equator.ra * 15 * DEG, decRad: equator.dec * DEG,
      ...angles, distanceAU: equator.dist,
      angularDiameterRad: 2 * Math.asin(radiusKm / (equator.dist * KM_PER_AU)),
      // Library empirical airless magnitude (geocentric phase law), with only
      // the inverse-square observer-distance correction. Not an extinction model.
      magnitude: illumination.mag + 5 * Math.log10(physicalDistance / illumination.geo_dist),
      illuminatedFraction, sunDirection,
    };
  });
  return {
    date: safeDate, location: safeLocation, equatorialToHorizontal: matrix, bodies,
    sunAltitudeDeg: bodies[0].altitudeDeg, moonPhaseDeg: MoonPhase(safeDate),
  };
}
