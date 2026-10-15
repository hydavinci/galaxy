/** Hierarchical, conservative frustum selection in the survey's actual frame. */
import { galacticToEquatorial, order2nside, pix2vecNested } from './healpix';

export interface VisibleTile {
  order: number;
  pix: number;
  /** Higher is nearer the view centre. */
  priority?: number;
}

export function chooseOrder(fov: number, viewportHeight: number, tileSize: number, maxOrder: number): number {
  if (!(fov > 0 && viewportHeight > 0 && tileSize > 0)) return 0;
  return Math.max(0, Math.min(12, maxOrder, Math.floor(Math.log2(Math.PI * viewportHeight / (2 * fov * tileSize)))));
}

/** A deliberately loose HEALPix centre cap (radians), including curved polar edges. */
export function tileAngularRadius(order: number): number {
  return Math.min(Math.PI, 2 / order2nside(order));
}

/**
 * view maps engine J2000 directions into camera space (including any horizontal
 * frame rotation). No translations/near/far clipping: this is an infinite sky.
 * Subdivision has a hard leaf budget. Budget-limited leaves stay coarse rather
 * than dropping coverage or drawing overlapping ancestors. Old four-arg calls
 * remain equatorial by default.
 */
export function getVisibleTiles(
  order: number, view: Float32Array, proj: Float32Array, _fov: number,
  frame: 'galactic' | 'equatorial' = 'equatorial', maxTiles = 256, angularMarginRad = 0,
): VisibleTile[] {
  const target = Math.max(0, Math.min(12, Math.floor(order)));
  const budget = Math.max(12, Math.min(512, Math.floor(maxTiles)));
  // Side planes in EQ coordinates: transpose(view.rotation) * projection plane.
  const planes: number[][] = [];
  for (const row of [0, 1]) for (const sign of [-1, 1]) {
    const n = [0, 1, 2].map(c => proj[c * 4 + 3] + sign * proj[c * 4 + row]);
    const p = [0, 1, 2].map(c => view[c * 4] * n[0] + view[c * 4 + 1] * n[1] + view[c * 4 + 2] * n[2]);
    const len = Math.hypot(...p);
    if (len > 0) planes.push(p.map(v => v / len));
  }
  const visible = (o: number, pix: number): VisibleTile | null => {
    let centre = pix2vecNested(order2nside(o), pix);
    if (frame === 'galactic') centre = galacticToEquatorial(centre);
    // Chord-distance sphere around centre encloses the entire angular cap.
    // Refraction is non-linear and cannot be folded into the view matrix.
    // Expand the angular cap before any hierarchical clipping, including roots.
    const margin = Number.isFinite(angularMarginRad) ? Math.max(0, angularMarginRad) : 0;
    const radius = 2 * Math.sin(Math.min(Math.PI, tileAngularRadius(o) + margin) / 2);
    if (planes.some(p => p[0] * centre[0] + p[1] * centre[1] + p[2] * centre[2] < -radius - 1e-7)) return null;
    const priority = -(view[2] * centre[0] + view[6] * centre[1] + view[10] * centre[2]);
    return { order: o, pix, priority };
  };
  let leaves: VisibleTile[] = [];
  for (let pix = 0; pix < 12; pix++) {
    const tile = visible(0, pix);
    if (tile) leaves.push(tile);
  }
  // Breadth first, centre first within each level. O(budget * target) nodes;
  // stop refining a leaf if its children would exceed the bounded draw budget.
  for (let level = 0; level < target; level++) {
    leaves.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const next: VisibleTile[] = [];
    let count = leaves.length;
    for (const leaf of leaves) {
      if (leaf.order !== level) { next.push(leaf); continue; }
      const children: VisibleTile[] = [];
      for (let child = 0; child < 4; child++) {
        const tile = visible(level + 1, leaf.pix * 4 + child);
        if (tile) children.push(tile);
      }
      if (count + children.length - 1 <= budget) {
        count += children.length - 1;
        next.push(...children);
      } else next.push(leaf);
    }
    leaves = next;
  }
  return leaves.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}
