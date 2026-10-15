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
      faceNum = (ifp & 3) + 4;
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
    const jp = Math.min(nside - 1, Math.floor(tp * tmp));
    const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));

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
  return vec2ang(...pix2vecNested(nside, pix));
}

/**
 * Get the 4 corner vertices of a HEALPix pixel (in theta, phi).
 * Returns [NE, NW, SW, SE] corners.
 */
export function pixCorners(nside: number, pix: number): Array<[number, number]> {
  return [[1, 1], [0, 1], [0, 0], [1, 0]].map(([u, v]) =>
    vec2ang(...pix2vecNested(nside, pix, u, v)));

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
export function nest2xyf(nside: number, pix: number): { ix: number; iy: number; face: number } {
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

// Stellarium's HEALPix planar mapping, shared by meshes AND visibility.
const FACES: [number, number][] = [
  [1, 0], [3, 0], [5, 0], [7, 0],
  [0, -1], [2, -1], [4, -1], [6, -1],
  [1, -2], [3, -2], [5, -2], [7, -2],
];

/** Continuous NESTED tile geometry. u follows ix, v follows iy; result is Y-up. */
export function pix2vecNested(nside: number, pix: number, u = 0.5, v = 0.5): [number, number, number] {
  const { ix, iy, face } = nest2xyf(nside, pix);
  const x = (FACES[face][0] + (ix - iy + u - v) / nside) * Math.PI / 4;
  const y = (FACES[face][1] + (ix + iy + u + v) / nside) * Math.PI / 4;
  return healpixXy2Vec(x, y);
}

export function healpixXy2Vec(x: number, y: number): [number, number, number] {
  let z: number, phi: number;
  if (Math.abs(y) > Math.PI / 4) {
    const sigma = Math.max(0, 2 - Math.abs(y * 4) / Math.PI);
    z = Math.sign(y) * (1 - sigma * sigma / 3);
    const xc = -Math.PI + (2 * Math.floor((x + Math.PI) * 2 / Math.PI) + 1) * Math.PI / 4;
    phi = sigma > 1e-14 ? xc + (x - xc) / sigma : x;
  } else {
    phi = x;
    z = y * 8 / (Math.PI * 3);
  }
  const r = Math.sqrt(Math.max(0, (1 - z) * (1 + z)));
  return [r * Math.cos(phi), z, r * Math.sin(phi)];
}

/** IAU Galactic -> J2000, with BOTH input and output axes permuted to engine Y-up.
 * Input: [cos(b) cos(l), sin(b), cos(b) sin(l)].
 * Output: [cos(dec) cos(RA), sin(dec), cos(dec) sin(RA)].
 */
export function galacticToEquatorial([x, y, z]: readonly number[]): [number, number, number] {
  return [
    -0.0548755604162154 * x - 0.8676661490190047 * y + 0.4941094278755837 * z,
    -0.4838350155487132 * x + 0.4559837761750669 * y + 0.7469822444972189 * z,
    -0.8734370902348850 * x - 0.1980763734312015 * y - 0.4448296299600112 * z,
  ];
}

/** HiPS images swap planar u/v. Descendant Morton bits must be swapped too. */
export function ancestorTextureTransform(order: number, pix: number, ancestorOrder: number): [number, number, number] {
  const delta = order - ancestorOrder;
  if (delta < 0) throw new RangeError('Texture ancestor is finer than geometry');
  const scale = 2 ** -delta;
  const remainder = pix % (4 ** delta);
  return [compress(remainder >> 1) * scale, compress(remainder) * scale, scale];
}
