/**
 * MagPoint — magnetic cursor engine.
 *
 * Selection (what actually gets clicked) is the bubble cursor (Grossman &
 * Balakrishnan, CHI 2005): each frame capture the clickable element with the
 * smallest point-to-rectangle distance, within `maxRadius`. Provably
 * distractor-robust — never grabs two targets at once.
 *
 * Presentation is decoupled and purely cosmetic: the captured element wears a
 * liquid-glass frame — one deformable rounded-rect outline per line box (so a
 * wrapped inline link hugs each line instead of one boxy union) that bulges
 * toward the pointer (B1 Gaussian falloff), clipping a backdrop-refraction
 * layer (blur + saturate + SVG feDisplacementMap lens) with a specular rim on
 * top. Hit-test never depends on the animation, so the goo can't mis-click.
 *
 * Tuning numbers were locked in playground/index.html (Phase 1).
 * The lens (backdrop-filter: url(#…)) renders in Chromium only; a Firefox
 * build should drop the url() term and keep blur/saturate. See
 * docs/liquid-glass-notes.md.
 */

import {
  clamp,
  clusterStackedFragments,
  frameRadiusFor,
  isOversizedTarget,
  pointToRects,
  preferCandidate,
  rectArea,
  routeClick,
  unionRect,
  type RectLike,
} from './geometry';

const CLICKABLE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
  'label[for]',
  'summary',
].join(',');

interface Candidate {
  el: HTMLElement;
  rect: DOMRect; // union bounding box — culling, visibility, single-frame render
  rects: DOMRect[]; // per-line fragment boxes (getClientRects); [rect] when on one line
}

type Pt = [number, number];

const opts = {
  maxRadius: 120, // R_max: don't snap to far targets; preserves empty-space clicks
  maxTargetHFrac: 0.5, // taller than this × viewport height → a container, not a target (excluded from selection)
  framePad: 6, // gap between element and the glass frame
  frameRadius: 14, // frame corner radius
  fuseHFrac: 0.5, // fuse stacked fragments sharing ≥ this fraction of the narrower's width (offset wrap halves ≈ 0)
  fuseVGap: 1.5, // ...and within this × avg fragment height vertically (folds in framePad + bulge reach)
  samples: 160, // perimeter sample count for the deformable outline
  baseBulge: 6, // resting bulge while hovering the element (breathing)
  pullMax: 26, // extra magnetic stretch toward the pointer, peaking mid-range (px)
  bulgeSigma: 45, // Gaussian spread of the bulge along the arc (px)
  bulgeR: 110, // pointer distance at which the bulge fully decays
  lensScale: 55, // feDisplacementMap scale
  lensThickness: 16, // rim band of the refraction map (px inward from the edge)
  blur: 0.5, // near-clear glass: the rim refraction carries the material, the element stays crisp
  saturate: 180, // backdrop vibrancy (%)
  spring: { k: 0.2, zeta: 0.7 }, // bulge target trails the pointer with a little overshoot
  morph: 0.35, // per-frame lerp of the outline toward its target (smooths capture switches)
};

let candidates: Candidate[] = [];
let raw: Pt = [-1, -1]; // physical pointer (drives selection)
const tip = { x: -1, y: -1, vx: 0, vy: 0 }; // bulge target, trails the pointer
let captured: Candidate | null = null;
let wasCaptured = false;
let enabled = true;
let dirty = true;

// One liquid-glass frame per line fragment of the captured element. The pool
// grows on demand and hides unused slots, so single-line targets use exactly
// frames[0] (rendered identically to the old single-frame path).
interface Frame {
  glass: HTMLDivElement;
  rimSvg: SVGSVGElement;
  rimPath: SVGPathElement; // core gradient stroke
  glowPath: SVGPathElement; // soft brand-blue halo under the core
  hotPath: SVGPathElement; // white hotspot on the pointer-facing side of the rim
  hotGrad: SVGRadialGradientElement;
  lensMap: SVGFEImageElement;
  framePts: Pt[] | null; // outline as currently drawn (lerps toward the target)
  mapKey: string; // frame size+radius the current displacement map was built for
  shown: boolean;
}

let defsRoot: HTMLDivElement; // container for every frame's feImage lens filter
const frames: Frame[] = [];
const SVG_NS = 'http://www.w3.org/2000/svg';

// ---- geometry -------------------------------------------------------------

function nearest(x: number, y: number): Candidate | null {
  let best: Candidate | null = null;
  let bestD = Infinity;
  let bestArea = Infinity;
  for (const c of candidates) {
    // measure against the nearest line fragment, not the union rect, so a wrapped
    // link stops claiming the empty gap between its lines (and the small targets in it)
    const d = pointToRects(x, y, c.rects);
    // break distance-0 ties (nested clickables under the pointer) by smaller area,
    // so the innermost control wins instead of an enclosing container
    if (preferCandidate(d, rectArea(c.rect), bestD, bestArea)) {
      bestD = d;
      bestArea = rectArea(c.rect);
      best = c;
    }
  }
  return best && bestD <= opts.maxRadius ? best : null;
}

// ---- candidate collection -------------------------------------------------

function isVisible(el: Element, rect: DOMRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) {
    return false;
  }
  const s = getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none' || s.pointerEvents === 'none' || Number(s.opacity) === 0) {
    return false;
  }
  return true;
}

function collect(): void {
  const els = document.querySelectorAll<HTMLElement>(CLICKABLE);
  const out: Candidate[] = [];
  els.forEach((el) => {
    if (el.id.startsWith('magpoint-')) return;
    const rect = el.getBoundingClientRect();
    // skip whole-column containers — a target taller than half the viewport is a
    // wrapper (x.com tweet / sidebar), not something to snap to
    if (isVisible(el, rect) && !isOversizedTarget(rect, innerHeight, opts.maxTargetHFrac)) {
      out.push({ el, rect, rects: lineFragments(el, rect) });
    }
  });
  candidates = out;
}

/** Per-line border boxes for a wrapped inline element; [rect] for anything on one line. */
function lineFragments(el: HTMLElement, rect: DOMRect): DOMRect[] {
  const list = el.getClientRects();
  if (list.length <= 1) return [rect];
  const frags: DOMRect[] = [];
  for (const r of list) if (r.width > 0 && r.height > 0) frags.push(r);
  return frags.length > 1 ? frags : [rect];
}

// ---- suppression (don't break normal use) ---------------------------------

function suppressed(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (a) {
    if (a.tagName === 'TEXTAREA' || a.isContentEditable) return true;
    if (a.tagName === 'INPUT') {
      const t = (a as HTMLInputElement).type;
      const nonText = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'];
      if (!nonText.includes(t)) return true;
    }
  }
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().length > 0) return true;
  return false;
}

// ---- liquid-glass geometry (shared with playground/index.html) -------------

interface PerimPt {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** Sample a rounded-rect outline into N points (by arc length) with outward unit normals. */
function roundRectPerimeter(x: number, y: number, w: number, h: number, r: number, N: number): PerimPt[] {
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const straightH = w - 2 * r;
  const straightV = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const total = 2 * straightH + 2 * straightV + 4 * arc;
  const pts: PerimPt[] = [];
  const mk = (px: number, py: number, nx: number, ny: number): PerimPt => ({ x: px, y: py, nx, ny });
  for (let i = 0; i < N; i++) {
    // walk the perimeter clockwise from the top-left corner's end:
    // top edge, TR arc, right edge, BR arc, bottom edge, BL arc, left edge, TL arc
    let seg = (i / N) * total;
    if (seg < straightH) {
      pts.push(mk(x + r + seg, y, 0, -1));
      continue;
    }
    seg -= straightH;
    if (seg < arc) {
      const a = -Math.PI / 2 + (seg / arc) * (Math.PI / 2);
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      pts.push(mk(x + w - r + nx * r, y + r + ny * r, nx, ny));
      continue;
    }
    seg -= arc;
    if (seg < straightV) {
      pts.push(mk(x + w, y + r + seg, 1, 0));
      continue;
    }
    seg -= straightV;
    if (seg < arc) {
      const a = (seg / arc) * (Math.PI / 2);
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      pts.push(mk(x + w - r + nx * r, y + h - r + ny * r, nx, ny));
      continue;
    }
    seg -= arc;
    if (seg < straightH) {
      pts.push(mk(x + w - r - seg, y + h, 0, 1));
      continue;
    }
    seg -= straightH;
    if (seg < arc) {
      const a = Math.PI / 2 + (seg / arc) * (Math.PI / 2);
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      pts.push(mk(x + r + nx * r, y + h - r + ny * r, nx, ny));
      continue;
    }
    seg -= arc;
    if (seg < straightV) {
      pts.push(mk(x, y + h - r - seg, -1, 0));
      continue;
    }
    seg -= straightV;
    {
      const a = Math.PI + (seg / arc) * (Math.PI / 2);
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      pts.push(mk(x + r + nx * r, y + r + ny * r, nx, ny));
    }
  }
  return pts;
}

/**
 * Displace perimeter points outward with a Gaussian bulge toward the cursor.
 * Falloff uses each point's Euclidean-distance excess over the closest point,
 * not arc distance to it: the shape along a straight edge is identical, but
 * the field is continuous everywhere — centering on the nearest point made the
 * bulge snap when that point jumped across a corner or the rect's medial axis.
 */
function deform(pts: PerimPt[], cursor: Pt, insideFrame: boolean): Pt[] {
  const d2s = new Array<number>(pts.length);
  let bestD2 = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - cursor[0];
    const dy = pts[i].y - cursor[1];
    d2s[i] = dx * dx + dy * dy;
    if (d2s[i] < bestD2) bestD2 = d2s[i];
  }
  const bestD = Math.sqrt(bestD2);
  const proximity = clamp(1 - bestD / opts.bulgeR, 0, 1);
  // magnetic stretch: 0 when resting on the element, peaks mid-range, 0 at R —
  // the frame visibly reaches for the pointer instead of barely rippling.
  // Outside-only: inside a large element the nearest-edge distance grows too,
  // which would bloom the frame away from a merely-hovering cursor. Both sides
  // of the boundary tend to 0, so the gate stays continuous.
  const x = clamp(bestD / opts.bulgeR, 0, 1);
  const amp = opts.baseBulge * proximity + (insideFrame ? 0 : opts.pullMax * 4 * x * (1 - x));
  const twoSigma2 = 2 * opts.bulgeSigma * opts.bulgeSigma;
  return pts.map((pt, i) => {
    const bulge = amp * Math.exp(-(d2s[i] - bestD2) / twoSigma2);
    return [pt.x + pt.nx * bulge, pt.y + pt.ny * bulge];
  });
}

/** One closed path through points via Catmull-Rom, emitted as cubic Béziers, offset to local coords. */
function catmullRomClosed(pts: Pt[], ox: number, oy: number): string {
  const n = pts.length;
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M ${f(pts[0][0] - ox)} ${f(pts[0][1] - oy)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const b1x = p1[0] + (p2[0] - p0[0]) / 6;
    const b1y = p1[1] + (p2[1] - p0[1]) / 6;
    const b2x = p2[0] - (p3[0] - p1[0]) / 6;
    const b2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${f(b1x - ox)} ${f(b1y - oy)}, ${f(b2x - ox)} ${f(b2y - oy)}, ${f(p2[0] - ox)} ${f(p2[1] - oy)} `;
  }
  return d + 'Z';
}

function sdRoundRect(x: number, y: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(x) - (hw - r);
  const qy = Math.abs(y) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdNormal(x: number, y: number, hw: number, hh: number, r: number): Pt {
  const e = 1;
  const gx = sdRoundRect(x + e, y, hw, hh, r) - sdRoundRect(x - e, y, hw, hh, r);
  const gy = sdRoundRect(x, y + e, hw, hh, r) - sdRoundRect(x, y - e, hw, hh, r);
  const l = Math.hypot(gx, gy) || 1;
  return [gx / l, gy / l];
}

function squircleSlope(t: number): number {
  // height y = (1 - (1-t)^4)^(1/4); slope normalized so rim (t~0) ≈ 1, tapered to 0 at center
  const u = 1 - t;
  const y = Math.pow(1 - Math.pow(u, 4), 0.25);
  const dy = y > 1e-4 ? Math.pow(u, 3) / Math.pow(y, 3) : 1;
  return clamp(dy, 0, 1) * (1 - t);
}

/** Rounded-rect refraction map (data-URL PNG): rim-concentrated displacement, flat center. */
function makeDisplacementMap(w: number, h: number, radius: number, thickness: number): string {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  const g = c.getContext('2d')!;
  const img = g.createImageData(c.width, c.height);
  const hw = c.width / 2;
  const hh = c.height / 2;
  const rr = Math.min(radius, Math.min(hw, hh));
  for (let py = 0; py < c.height; py++) {
    for (let px = 0; px < c.width; px++) {
      const sd = sdRoundRect(px - hw + 0.5, py - hh + 0.5, hw, hh, rr);
      const depth = -sd; // px inside from the edge
      let dx = 0;
      let dy = 0;
      if (depth > 0) {
        const t = clamp(depth / thickness, 0, 1); // 0 at rim → 1 inside (flat)
        const slope = squircleSlope(t);
        const nrm = sdNormal(px - hw + 0.5, py - hh + 0.5, hw, hh, rr); // outward
        dx = nrm[0] * slope;
        dy = nrm[1] * slope;
      }
      const idx = (py * c.width + px) * 4;
      img.data[idx] = clamp(128 + dx * 127, 0, 255);
      img.data[idx + 1] = clamp(128 + dy * 127, 0, 255);
      img.data[idx + 2] = 128;
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

// Refraction maps depend only on frame size + radius, so cache the data-URLs and
// share them across fragments and re-captures (per-fragment maps would otherwise
// rebuild every same-sized line box on link-dense pages). Bounded FIFO so a page
// with many distinct fragment sizes can't grow the cache without limit.
const mapCache = new Map<string, string>(); // WxHxR → data-URL
const MAP_CACHE_MAX = 64;
function displacementMap(w: number, h: number, radius: number, thickness: number): string {
  const key = `${Math.round(w)}x${Math.round(h)}x${Math.round(radius)}`;
  const hit = mapCache.get(key);
  if (hit !== undefined) return hit;
  const url = makeDisplacementMap(w, h, radius, thickness);
  if (mapCache.size >= MAP_CACHE_MAX) {
    const oldest = mapCache.keys().next().value;
    if (oldest !== undefined) mapCache.delete(oldest);
  }
  mapCache.set(key, url);
  return url;
}

// ---- liquid-glass rendering -------------------------------------------------

function hideFrame(frame: Frame): void {
  frame.framePts = null; // drop stale outline so a re-shown frame snaps, not slides
  if (!frame.shown) return;
  frame.glass.style.display = 'none';
  frame.rimSvg.style.display = 'none';
  frame.shown = false;
}

function hideFrames(from: number): void {
  for (let i = from; i < frames.length; i++) hideFrame(frames[i]);
}

function render(): void {
  if (!captured) {
    hideFrames(0);
    return;
  }
  const rects = captured.rects;
  const multi = rects.length > 1;
  // fuse fragments whose frames clearly overlap into one outline; separate lines
  // (a wrapped link's offset halves) stay as their own single-fragment groups
  const groups = multi ? clusterStackedFragments(rects, opts.fuseHFrac, opts.fuseVGap) : [[0]];
  ensureFrames(groups.length);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const box: RectLike = g.length === 1 ? rects[g[0]] : unionRect(g.map((k) => rects[k]));
    drawFrame(frames[i], box, multi);
  }
  hideFrames(groups.length); // retire frames left over from a wider capture
}

/** Draw one deformable glass frame around a line box or fused group box, bulging toward the pointer. */
function drawFrame(frame: Frame, r: RectLike, multi: boolean): void {
  const fx = r.left - opts.framePad;
  const fy = r.top - opts.framePad;
  const fw = r.right - r.left + opts.framePad * 2;
  const fh = r.bottom - r.top + opts.framePad * 2;
  const radius = frameRadiusFor(fw, fh, multi, opts.frameRadius);

  // deformable outline, bulging toward the (spring-smoothed) pointer. Every frame
  // shares the one pointer, so the fragment nearest the cursor reaches most and the
  // rest merely breathe — the set reads as one material. (Adjacent fragments' frames
  // overlap by ~framePad, so the backdrop-filter double-refracts a faint inter-line
  // seam — accepted; merging fragments into one continuous outline is out of scope.)
  const perim = roundRectPerimeter(fx, fy, fw, fh, radius, opts.samples);
  const inside = tip.x > fx && tip.x < fx + fw && tip.y > fy && tip.y < fy + fh;
  const target = deform(perim, [tip.x, tip.y], inside);

  // lerp the drawn outline toward its target — sample order is stable (top-left,
  // clockwise, N fixed), so a capture switch morphs liquidly instead of teleporting
  if (!frame.framePts || frame.framePts.length !== target.length) {
    frame.framePts = target;
  } else {
    for (let i = 0; i < target.length; i++) {
      frame.framePts[i][0] += (target[i][0] - frame.framePts[i][0]) * opts.morph;
      frame.framePts[i][1] += (target[i][1] - frame.framePts[i][1]) * opts.morph;
    }
  }
  const pts = frame.framePts;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  const d = catmullRomClosed(pts, minX, minY);

  // frost + lens: a backdrop-sampling box sized to the deformed bbox, clipped to the path
  frame.glass.style.display = 'block';
  frame.glass.style.transform = `translate(${minX}px, ${minY}px)`;
  frame.glass.style.width = `${bw}px`;
  frame.glass.style.height = `${bh}px`;
  frame.glass.style.clipPath = `path('${d}')`;

  // refraction map: rebuilt only when this frame's size/radius changes, stretched
  // to the deformed bbox by feImage (preserveAspectRatio=none) — never per frame
  const key = `${Math.round(fw)}x${Math.round(fh)}x${Math.round(radius)}`;
  if (key !== frame.mapKey) {
    frame.lensMap.setAttribute('href', displacementMap(fw, fh, radius, opts.lensThickness));
    frame.mapKey = key;
  }
  frame.lensMap.setAttribute('width', String(bw));
  frame.lensMap.setAttribute('height', String(bh));

  // luminous rim on the exact same path, hotspot centered on the pointer side
  frame.rimSvg.style.display = 'block';
  frame.rimSvg.style.transform = `translate(${minX}px, ${minY}px)`;
  frame.rimSvg.setAttribute('width', String(Math.ceil(bw)));
  frame.rimSvg.setAttribute('height', String(Math.ceil(bh)));
  frame.glowPath.setAttribute('d', d);
  frame.rimPath.setAttribute('d', d);
  frame.hotPath.setAttribute('d', d);
  frame.hotGrad.setAttribute('cx', String(tip.x - minX));
  frame.hotGrad.setAttribute('cy', String(tip.y - minY));
  frame.shown = true;
}

// ---- main loop ------------------------------------------------------------

function springTo(target: Pt): void {
  const { k, zeta } = opts.spring;
  const c = 2 * Math.sqrt(k) * zeta;
  tip.vx += k * (target[0] - tip.x) - c * tip.vx;
  tip.vy += k * (target[1] - tip.y) - c * tip.vy;
  tip.x += tip.vx;
  tip.y += tip.vy;
}

function frame(): void {
  if (enabled && raw[0] >= 0) {
    if (dirty) {
      collect();
      dirty = false;
    }
    captured = suppressed() ? null : nearest(raw[0], raw[1]);

    // seed the bulge target at the pointer on a fresh capture
    if (captured && !wasCaptured) {
      tip.x = raw[0];
      tip.y = raw[1];
      tip.vx = 0;
      tip.vy = 0;
    }
    wasCaptured = !!captured;

    if (captured) springTo(raw);

    document.documentElement.classList.toggle('magpoint-snapping', !!captured);
    render();
  }
  requestAnimationFrame(frame);
}

// ---- click routing --------------------------------------------------------

/**
 * Did the pointer land on something interactive in its own right? `closest(CLICKABLE)`
 * catches recognized controls (and their inner nodes); computed `cursor: pointer`
 * (an inherited property, so it reads through to inner spans/svgs) catches the ones
 * the selector can't name — a carousel arrow that's a plain `<div>` with a JS listener.
 * Either way the magnet must not hijack the click.
 */
function hitInteractive(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(CLICKABLE)) return true;
  return getComputedStyle(el).cursor === 'pointer';
}

function onClick(e: MouseEvent): void {
  if (!enabled || !captured || !e.isTrusted || suppressed()) return;
  const el = captured.el;
  // Redirect only when the click landed in dead space — a direct hit on the captured
  // target or on any other interactive element is the browser's to handle.
  if (routeClick(el.contains(e.target as Node), hitInteractive(e.target)) !== 'redirect') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  el.focus?.();
  el.click();
}

// ---- setup ----------------------------------------------------------------

function buildOverlay(): void {
  // shared, offscreen container holding each frame's feImage lens filter
  defsRoot = document.createElement('div');
  defsRoot.id = 'magpoint-filters';
  defsRoot.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none';
  document.documentElement.appendChild(defsRoot);
}

function ensureFrames(n: number): void {
  while (frames.length < n) frames.push(buildFrame(frames.length));
}

/** Build one frame's DOM: its own lens filter, backdrop-glass div, and rim SVG (ids suffixed by index so the per-frame url(#…) references never collide). */
function buildFrame(i: number): Frame {
  const filterId = `magpoint-lens-${i}`;
  const fsvg = document.createElementNS(SVG_NS, 'svg');
  fsvg.setAttribute('aria-hidden', 'true');
  fsvg.style.cssText = 'position:absolute;width:0;height:0';
  fsvg.innerHTML =
    `<defs><filter id="${filterId}" color-interpolation-filters="sRGB" x="-30%" y="-30%" width="160%" height="160%">` +
    '<feImage result="map" preserveAspectRatio="none" x="0" y="0"/>' +
    `<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" scale="${opts.lensScale}"/>` +
    '</filter></defs>';
  defsRoot.appendChild(fsvg);
  const lensMap = fsvg.querySelector('feImage') as SVGFEImageElement;

  const glass = document.createElement('div');
  glass.id = `magpoint-glass-${i}`;
  glass.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:none;' +
    'background:rgba(93,140,255,0.055);' + // faint tint so the slab reads on flat white pages
    `backdrop-filter:blur(${opts.blur}px) saturate(${opts.saturate}%) brightness(1.06) url(#${filterId})`;
  document.documentElement.appendChild(glass);

  const rimSvg = document.createElementNS(SVG_NS, 'svg');
  rimSvg.id = `magpoint-rim-${i}`;
  rimSvg.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:none;overflow:visible';
  rimSvg.innerHTML =
    '<defs>' +
    `<linearGradient id="magpoint-rim-grad-${i}" x1="0" y1="0" x2="0" y2="1">` +
    '<stop offset="0" stop-color="#cfe0ff"/><stop offset="0.5" stop-color="#5b8cff"/><stop offset="1" stop-color="#2f6bff"/>' +
    '</linearGradient>' +
    `<radialGradient id="magpoint-rim-hot-${i}" gradientUnits="userSpaceOnUse" r="90">` +
    '<stop offset="0" stop-color="rgba(255,255,255,0.95)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>' +
    '</radialGradient>' +
    '</defs>';
  const hotGrad = rimSvg.querySelector('radialGradient') as SVGRadialGradientElement;

  const glowPath = document.createElementNS(SVG_NS, 'path');
  glowPath.setAttribute('fill', 'none');
  glowPath.setAttribute('stroke', '#3f7bff');
  glowPath.setAttribute('stroke-width', '7');
  glowPath.setAttribute('opacity', '0.45');
  glowPath.style.filter = 'blur(3px)';
  rimSvg.appendChild(glowPath);

  const rimPath = document.createElementNS(SVG_NS, 'path');
  rimPath.setAttribute('fill', 'none');
  rimPath.setAttribute('stroke', `url(#magpoint-rim-grad-${i})`);
  rimPath.setAttribute('stroke-width', '2');
  rimPath.style.filter = 'drop-shadow(0 6px 14px rgba(31,64,175,.35))';
  rimSvg.appendChild(rimPath);

  const hotPath = document.createElementNS(SVG_NS, 'path');
  hotPath.setAttribute('fill', 'none');
  hotPath.setAttribute('stroke', `url(#magpoint-rim-hot-${i})`);
  hotPath.setAttribute('stroke-width', '2.4');
  rimSvg.appendChild(hotPath);

  document.documentElement.appendChild(rimSvg);

  return { glass, rimSvg, rimPath, glowPath, hotPath, hotGrad, lensMap, framePts: null, mapKey: '', shown: false };
}

function showBadge(text: string): void {
  let badge = document.getElementById('magpoint-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'magpoint-badge';
    badge.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:6px 12px;' +
      'border-radius:999px;font:600 12px/1 system-ui,sans-serif;color:#fff;' +
      'background:rgba(40,110,255,.95);pointer-events:none;transition:opacity .3s;box-shadow:0 2px 8px rgba(0,0,0,.2)';
    document.documentElement.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.opacity = '1';
  window.setTimeout(() => {
    if (badge) badge.style.opacity = '0';
  }, 1200);
}

export function startMagnet(): void {
  buildOverlay();

  addEventListener(
    'mousemove',
    (e) => {
      raw = [e.clientX, e.clientY];
    },
    true,
  );

  addEventListener('scroll', () => (dirty = true), true);
  addEventListener('resize', () => (dirty = true));

  const mo = new MutationObserver(() => (dirty = true));
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  document.addEventListener('click', onClick, true);

  addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      enabled = !enabled;
      if (!enabled) {
        captured = null;
        wasCaptured = false;
        document.documentElement.classList.remove('magpoint-snapping');
        hideFrames(0);
      }
      showBadge(enabled ? 'MagPoint ON' : 'MagPoint OFF');
    }
  });

  requestAnimationFrame(frame);
  showBadge('MagPoint ON · Alt+M to toggle');
}
