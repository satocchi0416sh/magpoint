import { describe, expect, it } from 'vitest';
import {
  clusterStackedFragments,
  frameRadiusFor,
  horizontalOverlapFraction,
  isOversizedTarget,
  pointToRect,
  pointToRects,
  preferCandidate,
  rectArea,
  routeClick,
  shouldCollect,
  type RectLike,
  unionRect,
  verticalGap,
} from './geometry';

const rect = (left: number, top: number, right: number, bottom: number): RectLike => ({ left, top, right, bottom });

describe('pointToRect', () => {
  it('is 0 inside the rect', () => {
    expect(pointToRect(50, 10, rect(0, 0, 100, 20))).toBe(0);
  });

  it('measures nearest-edge distance outside', () => {
    expect(pointToRect(103, 10, rect(0, 0, 100, 20))).toBe(3); // right of the edge
    expect(pointToRect(50, 24, rect(0, 0, 100, 20))).toBe(4); // below the edge
    expect(pointToRect(103, 24, rect(0, 0, 100, 20))).toBeCloseTo(5); // 3-4-5 corner
  });
});

describe('pointToRects — wrapped-link selection fix', () => {
  // A link whose text wraps: fragment 1 sits at the right of line 1, fragment 2 at
  // the left of line 2. Their union box spans the whole block between the lines.
  const frag1 = rect(100, 0, 200, 20);
  const frag2 = rect(0, 20, 80, 40);
  const union = rect(0, 0, 200, 40);

  it('does not claim the inter-line gap that the union rect swallows', () => {
    // A point sitting in the gap (below fragment 1, right of fragment 2) — exactly
    // where a small enclosed target lives. The union rect would report distance 0.
    expect(pointToRect(150, 30, union)).toBe(0); // union: enclosed target can never win
    expect(pointToRects(150, 30, [frag1, frag2])).toBe(10); // fragments: gap is free → enclosed target wins
  });

  it('returns the distance to the nearest fragment', () => {
    expect(pointToRects(150, 5, [frag1, frag2])).toBe(0); // inside fragment 1
    expect(pointToRects(40, 30, [frag1, frag2])).toBe(0); // inside fragment 2
    expect(pointToRects(90, 10, [frag1, frag2])).toBe(10); // between them, nearer frag1's left edge
  });

  it('equals pointToRect for a single-fragment (single-line) target', () => {
    const single = rect(0, 0, 100, 20);
    for (const [x, y] of [[50, 10], [120, 10], [50, 40], [130, 40]]) {
      expect(pointToRects(x, y, [single])).toBe(pointToRect(x, y, single));
    }
  });
});

describe('frameRadiusFor', () => {
  const R = 14;

  it('leaves single-line frames at the base radius regardless of size', () => {
    expect(frameRadiusFor(200, 34, false, R)).toBe(R);
    expect(frameRadiusFor(24, 24, false, R)).toBe(R); // single path unchanged (pixel-identity)
  });

  it('keeps the base radius for roomy wrap fragments', () => {
    expect(frameRadiusFor(120, 42, true, R)).toBe(R); // min/2 - 3 = 18 > 14
  });

  it('shrinks a short wrap fragment so it keeps a straight edge (no lozenge)', () => {
    // 28x36 fragment: min side 28 → 28/2 - 3 = 11 < 14, and 11 < 14 (half) so not a pill.
    expect(frameRadiusFor(28, 36, true, R)).toBe(11);
  });

  it('never drops below the 4px floor', () => {
    expect(frameRadiusFor(10, 10, true, R)).toBe(4);
  });
});

describe('isOversizedTarget — exclude whole-column containers', () => {
  const VH = 800;
  it('excludes a candidate taller than half the viewport (x.com column / sidebar)', () => {
    // AC1/AC3: a full-height tweet column or sidebar is a wrapper, not a target
    expect(isOversizedTarget(rect(0, 0, 600, 780), VH, 0.5)).toBe(true);
    expect(isOversizedTarget(rect(1150, 0, 1500, 760), VH, 0.5)).toBe(true); // narrow but full-height sidebar
  });
  it('keeps normal controls, including a big hero CTA below the ceiling (AC5)', () => {
    expect(isOversizedTarget(rect(0, 0, 120, 40), VH, 0.5)).toBe(false); // ordinary button
    expect(isOversizedTarget(rect(0, 0, 1400, 120), VH, 0.5)).toBe(false); // full-width short CTA
    expect(isOversizedTarget(rect(0, 0, 300, 400), VH, 0.5)).toBe(false); // 400 == 0.5×800, not strictly over
  });
});

describe('preferCandidate — innermost wins a distance-0 tie', () => {
  it('prefers the strictly nearer candidate regardless of area', () => {
    expect(preferCandidate(5, 10, 8, 1)).toBe(true); // nearer even though bigger
    expect(preferCandidate(8, 1, 5, 10)).toBe(false); // farther loses even though smaller
  });
  it('breaks an equal distance by smaller area (AC4: inner control over container)', () => {
    expect(preferCandidate(0, 100, 0, 5000)).toBe(true); // smaller area wins the 0-distance tie
    expect(preferCandidate(0, 5000, 0, 100)).toBe(false); // larger container loses the tie
  });
});

describe('rectArea', () => {
  it('multiplies width by height', () => {
    expect(rectArea(rect(0, 0, 100, 20))).toBe(2000);
  });
  it('is 0 for a degenerate rect', () => {
    expect(rectArea(rect(10, 10, 10, 40))).toBe(0);
  });
});

describe('shouldCollect — throttle candidate rebuilds', () => {
  const INTERVAL = 150;
  it('never collects when nothing changed', () => {
    expect(shouldCollect(false, 10_000, 0, INTERVAL)).toBe(false); // no rebuild without a dirty flag
  });
  it('collects a dirty page once the interval has elapsed', () => {
    expect(shouldCollect(true, 1150, 1000, INTERVAL)).toBe(true); // AC1: exactly interval since last
    expect(shouldCollect(true, 2000, 1000, INTERVAL)).toBe(true);
  });
  it('coalesces a burst: stays throttled within the interval', () => {
    expect(shouldCollect(true, 1100, 1000, INTERVAL)).toBe(false); // AC2: mutation 100ms after last → wait
  });
  it('collects immediately on the first frame (no prior rebuild)', () => {
    expect(shouldCollect(true, 0, -Infinity, INTERVAL)).toBe(true);
  });
});

describe('routeClick — never steal a direct hit', () => {
  it('passes through a hit inside the captured target', () => {
    // clicked the captured element itself → browser handles it (unchanged behavior)
    expect(routeClick(true, false)).toBe('captured-hit');
    expect(routeClick(true, true)).toBe('captured-hit'); // captured hit wins over interactivity
  });

  it('yields to another interactive element under the pointer', () => {
    // AC2/AC3: e.target is a real clickable / has cursor:pointer (e.g. a carousel arrow)
    // → leave it to the browser instead of clicking the captured neighbour
    expect(routeClick(false, true)).toBe('interactive-hit');
  });

  it('redirects a dead-space click to the captured target', () => {
    // AC4: pointer in empty space near the captured target → synthesize its click
    expect(routeClick(false, false)).toBe('redirect');
  });
});

describe('horizontalOverlapFraction', () => {
  it('is 0 for x-disjoint rects (a wrapped link’s offset halves)', () => {
    // measured: 410/410 wrapped links on ja.wikipedia 三島由紀夫 had hFrac 0
    expect(horizontalOverlapFraction(rect(100, 0, 200, 14), rect(0, 17, 80, 31))).toBe(0);
  });

  it('is 1 when the narrower is within the wider’s x-span (stacked search-result lines)', () => {
    // measured: title x[90,455], sitename x[90,336] → sitename fully inside title in x
    expect(horizontalOverlapFraction(rect(90, 208, 455, 223), rect(90, 179, 336, 194))).toBe(1);
  });
});

describe('verticalGap', () => {
  it('is positive when rects are separated in y', () => {
    expect(verticalGap(rect(0, 0, 10, 14), rect(0, 20, 10, 34))).toBe(6);
  });

  it('is negative when rects overlap in y', () => {
    expect(verticalGap(rect(0, 0, 10, 20), rect(0, 15, 10, 35))).toBe(-5);
  });
});

describe('unionRect', () => {
  it('bounds all rects', () => {
    expect(unionRect([rect(10, 20, 30, 40), rect(0, 25, 15, 60)])).toEqual(rect(0, 20, 30, 60));
  });
});

describe('clusterStackedFragments — fuse clearly-overlapping frames', () => {
  const HFRAC = 0.5;
  const VGAP = 1.5;

  it('keeps a wrapped link split: horizontally offset halves do not fuse', () => {
    // frag1 = end of line 1 (right), frag2 = start of line 2 (left) — hFrac 0
    const groups = clusterStackedFragments([rect(100, 0, 200, 14), rect(0, 17, 80, 31)], HFRAC, VGAP);
    expect(groups).toEqual([[0], [1]]);
  });

  it('fuses stacked search-result lines (real geometry: title + sitename, 14px gap)', () => {
    // title x[90,455] y[208,223], sitename x[90,336] y[179,194] → hFrac 1, gap 14 ≤ 1.5×15
    const groups = clusterStackedFragments([rect(90, 208, 455, 223), rect(90, 179, 336, 194)], HFRAC, VGAP);
    expect(groups).toEqual([[0, 1]]);
  });

  it('does not fuse horizontally-aligned lines that sit far apart vertically', () => {
    // aligned (hFrac 1) but 40px gap ≫ 1.5×14 → stay separate
    const groups = clusterStackedFragments([rect(0, 0, 300, 14), rect(0, 54, 300, 68)], HFRAC, VGAP);
    expect(groups).toEqual([[0], [1]]);
  });

  it('fuses transitively-stacked aligned lines into one group', () => {
    const groups = clusterStackedFragments(
      [rect(0, 0, 300, 14), rect(0, 18, 300, 32), rect(0, 36, 300, 50)],
      HFRAC,
      VGAP,
    );
    expect(groups).toEqual([[0, 1, 2]]);
  });

  it('returns one group for a single fragment', () => {
    expect(clusterStackedFragments([rect(0, 0, 100, 20)], HFRAC, VGAP)).toEqual([[0]]);
  });
});
