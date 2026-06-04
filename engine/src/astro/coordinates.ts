// Coordinate transformations

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Calculate Julian Date from Date
 */
export function dateToJD(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Julian centuries since J2000.0
 */
export function jdToT(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

/**
 * Greenwich Mean Sidereal Time in radians
 */
export function getGMST(jd: number): number {
  const T = jdToT(jd);
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T - T * T * T / 38710000.0;
  gmst = ((gmst % 360) + 360) % 360;
  return gmst * DEG2RAD;
}

/**
 * Local Sidereal Time in radians
 */
export function getLST(jd: number, lngRad: number): number {
  return getGMST(jd) + lngRad;
}

/**
 * Equatorial (RA/Dec) to Horizontal (Az/Alt)
 * All in radians
 */
export function equatorialToHorizontal(ra: number, dec: number, lat: number, lng: number, lst: number): { az: number; alt: number } {
  const ha = lst - ra;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(sinAlt);
  const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) / (Math.cos(alt) * Math.cos(lat));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (Math.sin(ha) > 0) az = 2 * Math.PI - az;
  return { az, alt };
}

/**
 * Horizontal (Az/Alt) to Equatorial (RA/Dec)
 * All in radians
 */
export function horizontalToEquatorial(az: number, alt: number, lat: number, lng: number, lst: number): { ra: number; dec: number } {
  const sinDec = Math.sin(alt) * Math.sin(lat) + Math.cos(alt) * Math.cos(lat) * Math.cos(az);
  const dec = Math.asin(sinDec);
  const cosHA = (Math.sin(alt) - Math.sin(dec) * Math.sin(lat)) / (Math.cos(dec) * Math.cos(lat));
  let ha = Math.acos(Math.max(-1, Math.min(1, cosHA)));
  if (Math.sin(az) > 0) ha = 2 * Math.PI - ha;
  const ra = ((lst - ha) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return { ra, dec };
}

/**
 * Equatorial to Galactic coordinates
 * All in radians
 */
export function equatorialToGalactic(ra: number, dec: number): { l: number; b: number } {
  // North Galactic Pole: RA=192.85948°, Dec=27.12825° (J2000)
  // Galactic center longitude: 122.93192°
  const ra_ngp = 192.85948 * DEG2RAD;
  const dec_ngp = 27.12825 * DEG2RAD;
  const l_ncp = 122.93192 * DEG2RAD;

  const sinB = Math.sin(dec) * Math.sin(dec_ngp) + Math.cos(dec) * Math.cos(dec_ngp) * Math.cos(ra - ra_ngp);
  const b = Math.asin(sinB);

  const cosLnum = Math.cos(dec) * Math.sin(ra - ra_ngp);
  const cosLden = Math.sin(dec) * Math.cos(dec_ngp) - Math.cos(dec) * Math.sin(dec_ngp) * Math.cos(ra - ra_ngp);
  let l = l_ncp - Math.atan2(cosLnum, cosLden);
  l = ((l % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  return { l, b };
}

export { DEG2RAD, RAD2DEG };
