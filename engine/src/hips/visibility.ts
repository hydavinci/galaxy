/**
 * Determine visible HEALPix tiles and appropriate LOD order.
 */

import { order2nside, nside2npix } from './healpix';

export interface VisibleTile {
  order: number;
  pix: number;
}

/**
 * Choose HiPS order based on FOV. Capped at 3 to keep tile count manageable.
 */
export function chooseOrder(fov: number, viewportHeight: number, tileSize: number, maxOrder: number): number {
  const angPerPx = fov / viewportHeight;
  const tileAng = angPerPx * tileSize;
  const nside = Math.PI / (2 * tileAng);
  const order = Math.max(0, Math.min(maxOrder, Math.floor(Math.log2(nside))));
  return order;
}

/**
 * Get all tiles for given order (no frustum culling - max 768 tiles at order 3).
 */
export function getVisibleTiles(
  order: number,
  _viewMatrix: Float32Array,
  _projMatrix: Float32Array,
  _fov: number
): VisibleTile[] {
  const nside = order2nside(order);
  const npix = nside2npix(nside);
  const result: VisibleTile[] = [];
  for (let pix = 0; pix < npix; pix++) {
    result.push({ order, pix });
  }
  return result;
}
