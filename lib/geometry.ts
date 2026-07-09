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

/** What a physical click should do when the magnet holds a captured target. */
export type ClickRouting = 'captured-hit' | 'interactive-hit' | 'redirect';

/**
 * Route a trusted click. The bubble cursor only reaches across empty space, so it
 * may synthesize a click on the captured target ('redirect') only when the pointer
 * landed in dead space. A hit inside the captured target ('captured-hit') or on any
 * other interactive element under the pointer ('interactive-hit') is left to the
 * browser, so that element's own handler runs — otherwise the magnet steals clicks
 * meant for controls it never captured (e.g. a carousel arrow with a JS listener).
 */
export function routeClick(insideCaptured: boolean, hitInteractive: boolean): ClickRouting {
  if (insideCaptured) return 'captured-hit';
  if (hitInteractive) return 'interactive-hit';
  return 'redirect';
}
