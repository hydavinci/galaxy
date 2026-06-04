// Simplified planetary positions using orbital elements
// Accuracy: ~1° for inner planets, ~0.5° for outer planets

import { jdToT } from './coordinates';

const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

interface PlanetData {
  name: string;
  ra: number;  // radians
  dec: number; // radians
  mag: number;
  color: string;
}

// Orbital elements at J2000.0 and rates per century
// [L0, L1, a, e0, e1, I0, I1, omega0, omega1, Omega0, Omega1]
// L=mean longitude(deg), a=semi-major axis(AU), e=eccentricity, I=inclination(deg), omega=arg perihelion(deg), Omega=ascending node(deg)
interface OrbitalElements {
  L0: number; L1: number;
  a: number;
  e0: number; e1: number;
  I0: number; I1: number;
  w0: number; w1: number;  // longitude of perihelion
  O0: number; O1: number;  // longitude of ascending node
}

const PLANETS: Record<string, OrbitalElements> = {
  Mercury: { L0: 252.2509, L1: 149472.6746, a: 0.387098, e0: 0.205635, e1: 0.000020, I0: 7.0050, I1: -0.0060, w0: 77.4561, w1: 1.5564, O0: 48.3309, O1: -0.1254 },
  Venus:   { L0: 181.9798, L1: 58517.8157, a: 0.723330, e0: 0.006773, e1: -0.000048, I0: 3.3947, I1: -0.0008, w0: 131.5637, w1: 1.4022, O0: 76.6799, O1: -0.2780 },
  Earth:   { L0: 100.4664, L1: 35999.3729, a: 1.000001, e0: 0.016709, e1: -0.000042, I0: 0.0, I1: 0.0, w0: 102.9373, w1: 1.7192, O0: 0.0, O1: 0.0 },
  Mars:    { L0: 355.4533, L1: 19140.2993, a: 1.523679, e0: 0.093405, e1: 0.000090, I0: 1.8497, I1: -0.0013, w0: 336.0602, w1: 1.8410, O0: 49.5574, O1: -0.2950 },
  Jupiter: { L0: 34.3515, L1: 3034.9057, a: 5.202887, e0: 0.048498, e1: 0.000164, I0: 1.3033, I1: -0.0020, w0: 14.3312, w1: 1.6126, O0: 100.4644, O1: 0.1768 },
  Saturn:  { L0: 50.0774, L1: 1222.1138, a: 9.536676, e0: 0.054151, e1: -0.000295, I0: 2.4889, I1: 0.0025, w0: 93.0572, w1: 1.9637, O0: 113.6634, O1: -0.2507 },
  Uranus:  { L0: 314.0550, L1: 428.4677, a: 19.18916, e0: 0.047168, e1: -0.000019, I0: 0.7732, I1: 0.0001, w0: 173.0053, w1: 1.4864, O0: 74.0060, O1: 0.0741 },
  Neptune: { L0: 304.3487, L1: 218.4862, a: 30.06992, e0: 0.008586, e1: 0.000025, I0: 1.7700, I1: -0.0003, w0: 48.1227, w1: 1.4262, O0: 131.7841, O1: -0.0061 },
};

const PLANET_COLORS: Record<string, string> = {
  Sun: '#FFE030',
  Moon: '#E8E8D0',
  Mercury: '#B0B0B0',
  Venus: '#FFFFCC',
  Mars: '#FF6633',
  Jupiter: '#FFD699',
  Saturn: '#FFCC66',
  Uranus: '#99FFFF',
  Neptune: '#6699FF',
};

function normalizeAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Solve Kepler's equation M = E - e*sin(E)
 */
function solveKepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 10; i++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-8) break;
  }
  return E;
}

/**
 * Compute heliocentric ecliptic coordinates from orbital elements
 */
function helioEcliptic(el: OrbitalElements, T: number): { x: number; y: number; z: number } {
  const L = (el.L0 + el.L1 * T) * DEG2RAD;
  const e = el.e0 + el.e1 * T;
  const I = (el.I0 + el.I1 * T) * DEG2RAD;
  const w = (el.w0 + el.w1 * T) * DEG2RAD;
  const O = (el.O0 + el.O1 * T) * DEG2RAD;
  const a = el.a;

  const omega = w - O; // argument of perihelion
  const M = normalizeAngle(L - w);
  const E = solveKepler(M, e);

  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cosO = Math.cos(O), sinO = Math.sin(O);
  const cosI = Math.cos(I), sinI = Math.sin(I);
  const cosW = Math.cos(omega), sinW = Math.sin(omega);

  const x = (cosO * cosW - sinO * sinW * cosI) * xp + (-cosO * sinW - sinO * cosW * cosI) * yp;
  const y = (sinO * cosW + cosO * sinW * cosI) * xp + (-sinO * sinW + cosO * cosW * cosI) * yp;
  const z = (sinW * sinI) * xp + (cosW * sinI) * yp;

  return { x, y, z };
}

/**
 * Convert ecliptic to equatorial coordinates
 * obliquity of ecliptic ≈ 23.4393°
 */
function eclipticToEquatorial(lon: number, lat: number): { ra: number; dec: number } {
  const eps = 23.4393 * DEG2RAD;
  const sinEps = Math.sin(eps), cosEps = Math.cos(eps);

  const sinDec = Math.sin(lat) * cosEps + Math.cos(lat) * sinEps * Math.sin(lon);
  const dec = Math.asin(sinDec);

  const y = Math.sin(lon) * cosEps - Math.tan(lat) * sinEps;
  const x = Math.cos(lon);
  const ra = normalizeAngle(Math.atan2(y, x));

  return { ra, dec };
}

/**
 * Get geocentric RA/Dec for a planet
 */
function getPlanetRADec(name: string, T: number): { ra: number; dec: number } {
  const earthPos = helioEcliptic(PLANETS.Earth, T);
  const planetPos = helioEcliptic(PLANETS[name], T);

  // Geocentric rectangular ecliptic
  const dx = planetPos.x - earthPos.x;
  const dy = planetPos.y - earthPos.y;
  const dz = planetPos.z - earthPos.z;

  const lon = Math.atan2(dy, dx);
  const lat = Math.atan2(dz, Math.sqrt(dx * dx + dy * dy));

  return eclipticToEquatorial(lon, lat);
}

/**
 * Simplified Sun position
 */
function getSunPosition(T: number): { ra: number; dec: number } {
  const L0 = 280.46646 + 36000.76983 * T;
  const M = (357.52911 + 35999.05029 * T) * DEG2RAD;
  const C = (1.9146 * Math.sin(M) + 0.02 * Math.sin(2 * M)) * DEG2RAD;
  const lon = (L0 * DEG2RAD + C);
  return eclipticToEquatorial(lon, 0);
}

/**
 * Simplified Moon position (accuracy ~1-2°)
 */
function getMoonPosition(T: number): { ra: number; dec: number } {
  const L0 = 218.3165 + 481267.8813 * T;  // mean longitude
  const M = 134.9634 + 477198.8676 * T;    // mean anomaly
  const F = 93.2720 + 483202.0175 * T;     // argument of latitude
  const D = 297.8502 + 445267.1115 * T;    // mean elongation
  const Ms = 357.5291 + 35999.0503 * T;    // sun mean anomaly

  const Lrad = L0 * DEG2RAD;
  const Mrad = M * DEG2RAD;
  const Frad = F * DEG2RAD;
  const Drad = D * DEG2RAD;
  const Msrad = Ms * DEG2RAD;

  // Longitude corrections
  const lon = Lrad +
    6.289 * DEG2RAD * Math.sin(Mrad) +
    1.274 * DEG2RAD * Math.sin(2 * Drad - Mrad) +
    0.658 * DEG2RAD * Math.sin(2 * Drad) +
    0.214 * DEG2RAD * Math.sin(2 * Mrad) -
    0.186 * DEG2RAD * Math.sin(Msrad) -
    0.114 * DEG2RAD * Math.sin(2 * Frad);

  // Latitude
  const lat = 5.128 * DEG2RAD * Math.sin(Frad) +
    0.281 * DEG2RAD * Math.sin(Mrad + Frad) +
    0.278 * DEG2RAD * Math.sin(Mrad - Frad);

  return eclipticToEquatorial(lon, lat);
}

/**
 * Approximate visual magnitudes
 */
function getPlanetMag(name: string): number {
  const mags: Record<string, number> = {
    Sun: -26.7, Moon: -12.5, Mercury: 0.0, Venus: -4.0,
    Mars: 1.0, Jupiter: -2.0, Saturn: 0.5, Uranus: 5.7, Neptune: 7.8
  };
  return mags[name] ?? 0;
}

/**
 * Get all planet positions for given Julian Date
 */
export function getAllPlanets(jd: number): PlanetData[] {
  const T = jdToT(jd);
  const result: PlanetData[] = [];

  // Sun
  const sun = getSunPosition(T);
  result.push({ name: 'Sun', ra: sun.ra, dec: sun.dec, mag: -26.7, color: PLANET_COLORS.Sun });

  // Moon
  const moon = getMoonPosition(T);
  result.push({ name: 'Moon', ra: moon.ra, dec: moon.dec, mag: -12.5, color: PLANET_COLORS.Moon });

  // Planets (not Earth)
  for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    const pos = getPlanetRADec(name, T);
    result.push({ name, ra: pos.ra, dec: pos.dec, mag: getPlanetMag(name), color: PLANET_COLORS[name] });
  }

  return result;
}

export type { PlanetData };
