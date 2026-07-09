/**
 * Pure geometry for target selection and frame sizing — no DOM, no canvas, so it
 * runs under a plain node test runner. The DOM-bound rendering math (perimeter
 * sampling, refraction map) stays in magnet.ts alongside the elements it drives.
 */

/** Structural subset of DOMRect the selection math needs (so tests pass plain objects). */
export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Shortest distance from a point to a rectangle (0 if inside) — nearest-edge metric. */
export function pointToRect(x: number, y: number, r: RectLike): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/**
 * Distance to the nearest of an element's line-fragment boxes. A link that wraps
 * across lines exposes its actual line boxes here, so it no longer claims the
 * empty gap between them — a small target sitting in that gap wins selection
 * instead of losing to the union rect's distance-0 interior.
 */
export function pointToRects(x: number, y: number, rects: RectLike[]): number {
  let best = Infinity;
  for (const r of rects) {
    const d = pointToRect(x, y, r);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Corner radius for one glass frame. Single-line targets are unchanged (the
 * caller's frameRadius, then clamped downstream by the perimeter builder). Short
 * wrap fragments keep a straight edge instead of rounding into a full lozenge.
 */
export function frameRadiusFor(fw: number, fh: number, multi: boolean, frameRadius: number): number {
  if (!multi) return frameRadius;
  const lim = Math.min(fw, fh) / 2 - 3; // leave ≥3px of straight edge → no pill
  return clamp(Math.min(frameRadius, lim), 4, frameRadius);
}

/** Bounding box of several rects. */
export function unionRect(rects: RectLike[]): RectLike {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.left < left) left = r.left;
    if (r.top < top) top = r.top;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return { left, top, right, bottom };
}

/** Horizontal overlap of two rects as a fraction of the narrower one's width (0 = disjoint in x). */
export function horizontalOverlapFraction(a: RectLike, b: RectLike): number {
  const ov = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  if (ov <= 0) return 0;
  const minW = Math.min(a.right - a.left, b.right - b.left);
  return minW > 0 ? ov / minW : 0;
}

/** Vertical gap between two rects (> 0 = gap between them, ≤ 0 = they overlap in y). */
export function verticalGap(a: RectLike, b: RectLike): number {
  return Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
}

/**
 * Two stacked line boxes fuse when they clearly share horizontal extent AND sit
 * within a line-height of each other. Measured empirically: a wrapped link's two
 * halves are horizontally offset (end-of-line / start-of-line → hFrac ≈ 0, 410/410
 * on a real article) and stay split; stacked full-width lines (a search result's
 * sitename + title) are left-aligned (hFrac ≈ 1) and fuse. `framePad`/bulge reach
 * is folded into `vGapFactor` (gap ≤ factor × avg fragment height).
 */
export function shouldFuse(a: RectLike, b: RectLike, hFracThreshold: number, vGapFactor: number): boolean {
  if (horizontalOverlapFraction(a, b) < hFracThreshold) return false;
  const avgH = (a.bottom - a.top + (b.bottom - b.top)) / 2;
  return verticalGap(a, b) <= vGapFactor * avgH;
}

/**
 * Group fragment indices whose frames clearly overlap (see {@link shouldFuse}) so
 * they render as one outline; horizontally-offset wrap halves stay in their own
 * single-element group. Union-find, so transitively-fusing fragments (A–B, B–C)
 * collapse into one group.
 */
export function clusterStackedFragments(rects: RectLike[], hFracThreshold: number, vGapFactor: number): number[][] {
  const n = rects.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldFuse(rects[i], rects[j], hFracThreshold, vGapFactor)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}
