/**
 * HEALPix (Hierarchical Equal Area isoLatitude Pixelization) implementation
 * for NESTED ordering scheme used by HiPS.
 * 
 * Reference: Gorski et al. 2005, "HEALPix: A Framework for High-Resolution
 * Discretization and Fast Analysis of Data Distributed on the Sphere"
 */

const TWOPI = 2 * Math.PI;
const PI = Math.PI;
const HALFPI = Math.PI / 2;

/**
 * Number of pixels at a given order: npix = 12 * nside^2
 * nside = 2^order
 */
export function nside2npix(nside: number): number {
  return 12 * nside * nside;
}

export function order2nside(order: number): number {
  return 1 << order;
}

/**
 * Convert (theta, phi) to NESTED pixel index.
 * theta: co-latitude [0, pi] (0 = north pole)
 * phi: longitude [0, 2*pi)
 */
export function ang2pixNested(nside: number, theta: number, phi: number): number {
  const nside2 = nside * nside;
  const nl2 = 2 * nside;
  const nl4 = 4 * nside;
  const ncap = nl2 * (nside - 1); // pixels in north polar cap
  const npix = 12 * nside2;

  // Normalize phi
  let ph = phi % TWOPI;
  if (ph < 0) ph += TWOPI;

  const cosTheta = Math.cos(theta);
  const absZ = Math.abs(cosTheta);
  const tt = ph / HALFPI; // [0, 4)

  let faceNum: number, ix: number, iy: number;

  if (absZ <= 2.0 / 3.0) {
    // Equatorial region
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * cosTheta * 0.75;
    const jp = Math.floor(temp1 - temp2); // ascending edge index
    const jm = Math.floor(temp1 + temp2); // descending edge index

    const ifp = Math.floor(jp / nside); // face (0-3)
    const ifm = Math.floor(jm / nside);

    if (ifp === ifm) {
      faceNum = ifp + 4;
    } else if (ifp < ifm) {
      faceNum = ifp;
    } else {
      faceNum = ifm + 8;
    }

    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    // Polar region
    const tp = tt - Math.floor(tt);
    const ntt = Math.min(3, Math.floor(tt));

    const tmp = nside * Math.sqrt(3 * (1 - absZ));
    const jp = Math.floor(tp * tmp);
    const jm = Math.floor((1 - tp) * tmp);

    if (jp + jm >= nside) {
      // At boundary, clamp
      // This shouldn't normally happen with proper inputs
    }

    if (cosTheta >= 0) {
      // North pole
      faceNum = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      // South pole
      faceNum = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }

  return xyf2nest(nside, ix, iy, faceNum);
}

/**
 * Convert NESTED pixel index to (theta, phi) — pixel center.
 */
export function pix2angNested(nside: number, pix: number): [number, number] {
  const nside2 = nside * nside;
  const npix = 12 * nside2;
  const nl4 = 4 * nside;

  const { ix, iy, face } = nest2xyf(nside, pix);
  const jr = (jrll[face] * nside) - ix - iy - 1;

  let theta: number, phi: number;

  if (jr < nside) {
    // North polar cap
    const nr = jr;
    const tmp = nr * nr * (1.0 / (3.0 * nside2));
    theta = Math.acos(1 - tmp);
    const kp = Math.max(1, Math.floor((ix - iy + 1) / 2));
    phi = (kp - 0.5) * HALFPI / nr;
  } else if (jr > 3 * nside) {
    // South polar cap
    const nr = nl4 - jr;
    const tmp = nr * nr * (1.0 / (3.0 * nside2));
    theta = Math.acos(-1 + tmp);
    const kp = Math.max(1, Math.floor((ix - iy + 1) / 2));
    phi = (kp - 0.5) * HALFPI / nr;
  } else {
    // Equatorial region
    const nr = nside;
    const fctr = (jr - nside) % 2 === 0 ? 1 : 0.5;
    const kp = Math.floor((ix - iy + 1) / 2) + (jr - nside) * nside / 2;
    // Simpler: just use the formula
    const z = (2 * nside - jr) * (2.0 / (3.0 * nside));
    theta = Math.acos(z);
    phi = ((ix - iy + 0.5 + ((jr - nside) & 1) * 0.5) * PI) / (2 * nside);
    if (phi < 0) phi += TWOPI;
  }

  // Adjust phi for face
  phi += (jpll[face] * HALFPI) / 2;
  if (phi >= TWOPI) phi -= TWOPI;
  if (phi < 0) phi += TWOPI;

  return [theta, phi];
}

/**
 * Get the 4 corner vertices of a HEALPix pixel (in theta, phi).
 * Returns [NE, NW, SW, SE] corners.
 */
export function pixCorners(nside: number, pix: number): Array<[number, number]> {
  const { ix, iy, face } = nest2xyf(nside, pix);
  const nside2 = nside * nside;
  const nl4 = 4 * nside;

  // Get the 4 corners by offsetting half a pixel
  const corners: Array<[number, number]> = [];
  const offsets = [
    [0.5, 0],   // N
    [0, 0.5],   // W
    [-0.5, 0],  // S
    [0, -0.5],  // E
  ];

  for (const [dx, dy] of offsets) {
    const fx = ix + dx + 0.5;
    const fy = iy + dy + 0.5;
    
    const jr = (jrll[face] * nside) - Math.floor(fx) - Math.floor(fy) - 1;
    
    let theta: number, phi: number;
    
    if (jr < nside) {
      const nr = Math.max(1, jr);
      const z = 1 - jr * jr / (3.0 * nside2);
      theta = Math.acos(Math.max(-1, Math.min(1, z)));
      const kp = (fx - fy + 1) / 2;
      phi = (kp - 0.5) * HALFPI / nr + jpll[face] * HALFPI / 2;
    } else if (jr > 3 * nside) {
      const nr = Math.max(1, nl4 - jr);
      const z = -1 + nr * nr / (3.0 * nside2);
      theta = Math.acos(Math.max(-1, Math.min(1, z)));
      const kp = (fx - fy + 1) / 2;
      phi = (kp - 0.5) * HALFPI / nr + jpll[face] * HALFPI / 2;
    } else {
      const z = (2 * nside - jr) * 2.0 / (3.0 * nside);
      theta = Math.acos(Math.max(-1, Math.min(1, z)));
      const shift = ((jr - nside) & 1) === 0 ? 0 : 0.5;
      const kp = (fx - fy + shift) / 2;
      phi = kp * PI / (2 * nside) + jpll[face] * HALFPI / 2;
    }
    
    if (phi < 0) phi += TWOPI;
    if (phi >= TWOPI) phi -= TWOPI;
    corners.push([theta, phi]);
  }

  return corners;
}

/**
 * Get the 4 child pixel indices (nested order) of a parent pixel.
 */
export function pixChildren(pix: number): [number, number, number, number] {
  const base = pix * 4;
  return [base, base + 1, base + 2, base + 3];
}

/**
 * Get parent pixel index.
 */
export function pixParent(pix: number): number {
  return Math.floor(pix / 4);
}

/**
 * Convert (theta, phi) to unit vector [x, y, z].
 * Using equatorial convention: y = up (Dec), x/z = RA plane.
 */
export function ang2vec(theta: number, phi: number): [number, number, number] {
  const sinTheta = Math.sin(theta);
  return [
    sinTheta * Math.cos(phi),  // x
    Math.cos(theta),            // y (up = north pole)
    sinTheta * Math.sin(phi),  // z
  ];
}

/**
 * Convert unit vector to (theta, phi).
 */
export function vec2ang(x: number, y: number, z: number): [number, number] {
  const theta = Math.acos(Math.max(-1, Math.min(1, y)));
  let phi = Math.atan2(z, x);
  if (phi < 0) phi += TWOPI;
  return [theta, phi];
}

// ---- Internal helpers ----

// Face numbering lookup tables
const jrll = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const jpll = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];

/**
 * Convert (ix, iy, face) to nested pixel index.
 */
function xyf2nest(nside: number, ix: number, iy: number, face: number): number {
  return face * nside * nside + spread(ix) + 2 * spread(iy);
}

/**
 * Convert nested pixel index to (ix, iy, face).
 */
function nest2xyf(nside: number, pix: number): { ix: number; iy: number; face: number } {
  const nside2 = nside * nside;
  const face = Math.floor(pix / nside2);
  const remainder = pix % nside2;
  const ix = compress(remainder);
  const iy = compress(remainder >> 1);
  return { ix, iy, face };
}

/**
 * Spread bits: interleave zeros between bits.
 * 0b1011 -> 0b1000101
 */
function spread(v: number): number {
  v &= 0xffff;
  v = (v | (v << 8)) & 0x00ff00ff;
  v = (v | (v << 4)) & 0x0f0f0f0f;
  v = (v | (v << 2)) & 0x33333333;
  v = (v | (v << 1)) & 0x55555555;
  return v;
}

/**
 * Compress bits: extract every other bit.
 * 0b1000101 -> 0b1011
 */
function compress(v: number): number {
  v &= 0x55555555;
  v = (v | (v >> 1)) & 0x33333333;
  v = (v | (v >> 2)) & 0x0f0f0f0f;
  v = (v | (v >> 4)) & 0x00ff00ff;
  v = (v | (v >> 8)) & 0x0000ffff;
  return v;
}
