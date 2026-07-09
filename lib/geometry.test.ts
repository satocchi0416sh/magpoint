import { describe, expect, it } from 'vitest';
import { frameRadiusFor, pointToRect, pointToRects, type RectLike } from './geometry';

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
