/**
 * MagPoint — magnetic cursor engine.
 *
 * Selection (what actually gets clicked) is the bubble cursor (Grossman &
 * Balakrishnan, CHI 2005): each frame capture the clickable element with the
 * smallest point-to-rectangle distance, within `maxRadius`. Provably
 * distractor-robust — never grabs two targets at once.
 *
 * Presentation is decoupled and purely cosmetic: the captured element wears a
 * liquid-glass frame — a single deformable rounded-rect outline that bulges
 * toward the pointer (B1 Gaussian falloff), clipping a backdrop-refraction
 * layer (blur + saturate + SVG feDisplacementMap lens) with a specular rim on
 * top. Hit-test never depends on the animation, so the goo can't mis-click.
 *
 * Tuning numbers were locked in playground/index.html (Phase 1).
 * The lens (backdrop-filter: url(#…)) renders in Chromium only; a Firefox
 * build should drop the url() term and keep blur/saturate. See
 * docs/liquid-glass-notes.md.
 */

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
  rect: DOMRect;
}

type Pt = [number, number];

const opts = {
  maxRadius: 120, // R_max: don't snap to far targets; preserves empty-space clicks
  framePad: 6, // gap between element and the glass frame
  frameRadius: 14, // frame corner radius
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

let glass: HTMLDivElement;
let rimSvg: SVGSVGElement;
let rimPath: SVGPathElement; // core gradient stroke
let glowPath: SVGPathElement; // soft brand-blue halo under the core
let hotPath: SVGPathElement; // white hotspot on the pointer-facing side of the rim
let hotGrad: SVGRadialGradientElement;
let lensMap: SVGFEImageElement;
let shown = false;
let mapKey = ''; // frame size the current displacement map was built for
let framePts: Pt[] | null = null; // outline as currently drawn (lerps toward the target)

// ---- geometry -------------------------------------------------------------

/** Shortest distance from a point to a rectangle (0 if inside) — nearest-edge metric. */
function pointToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

function nearest(x: number, y: number): Candidate | null {
  let best: Candidate | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = pointToRect(x, y, c.rect);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best && bestD <= opts.maxRadius ? best : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
    if (isVisible(el, rect)) out.push({ el, rect });
  });
  candidates = out;
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

// ---- liquid-glass rendering -------------------------------------------------

function hideGlass(): void {
  framePts = null;
  if (!shown) return;
  glass.style.display = 'none';
  rimSvg.style.display = 'none';
  shown = false;
}

function render(): void {
  if (!captured) {
    hideGlass();
    return;
  }
  const r = captured.rect;
  const fx = r.left - opts.framePad;
  const fy = r.top - opts.framePad;
  const fw = r.width + opts.framePad * 2;
  const fh = r.height + opts.framePad * 2;

  // single deformable outline, bulging toward the (spring-smoothed) pointer
  const perim = roundRectPerimeter(fx, fy, fw, fh, opts.frameRadius, opts.samples);
  const inside = tip.x > fx && tip.x < fx + fw && tip.y > fy && tip.y < fy + fh;
  const target = deform(perim, [tip.x, tip.y], inside);

  // lerp the drawn outline toward its target — sample order is stable (top-left,
  // clockwise, N fixed), so a capture switch morphs liquidly instead of teleporting
  if (!framePts || framePts.length !== target.length) {
    framePts = target;
  } else {
    for (let i = 0; i < target.length; i++) {
      framePts[i][0] += (target[i][0] - framePts[i][0]) * opts.morph;
      framePts[i][1] += (target[i][1] - framePts[i][1]) * opts.morph;
    }
  }
  const pts = framePts;

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
  glass.style.display = 'block';
  glass.style.transform = `translate(${minX}px, ${minY}px)`;
  glass.style.width = `${bw}px`;
  glass.style.height = `${bh}px`;
  glass.style.clipPath = `path('${d}')`;

  // refraction map: rebuilt only when the captured frame size changes, stretched
  // to the deformed bbox by feImage (preserveAspectRatio=none) — never per frame
  const key = `${Math.round(fw)}x${Math.round(fh)}`;
  if (key !== mapKey) {
    lensMap.setAttribute('href', makeDisplacementMap(fw, fh, opts.frameRadius, opts.lensThickness));
    mapKey = key;
  }
  lensMap.setAttribute('width', String(bw));
  lensMap.setAttribute('height', String(bh));

  // luminous rim on the exact same path, hotspot centered on the pointer side
  rimSvg.style.display = 'block';
  rimSvg.style.transform = `translate(${minX}px, ${minY}px)`;
  rimSvg.setAttribute('width', String(Math.ceil(bw)));
  rimSvg.setAttribute('height', String(Math.ceil(bh)));
  glowPath.setAttribute('d', d);
  rimPath.setAttribute('d', d);
  hotPath.setAttribute('d', d);
  hotGrad.setAttribute('cx', String(tip.x - minX));
  hotGrad.setAttribute('cy', String(tip.y - minY));
  shown = true;
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

function onClick(e: MouseEvent): void {
  if (!enabled || !captured || !e.isTrusted || suppressed()) return;
  const el = captured.el;
  if (el.contains(e.target as Node)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  el.focus?.();
  el.click();
}

// ---- setup ----------------------------------------------------------------

function buildOverlay(): void {
  // SVG filter defs (lens) — feImage href is filled in lazily by render()
  const defs = document.createElement('div');
  defs.id = 'magpoint-filters';
  defs.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none';
  defs.innerHTML =
    '<svg aria-hidden="true" style="position:absolute;width:0;height:0"><defs>' +
    '<filter id="magpoint-lens" color-interpolation-filters="sRGB" x="-30%" y="-30%" width="160%" height="160%">' +
    '<feImage result="map" preserveAspectRatio="none" x="0" y="0"/>' +
    `<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" scale="${opts.lensScale}"/>` +
    '</filter></defs></svg>';
  document.documentElement.appendChild(defs);
  lensMap = defs.querySelector('feImage') as SVGFEImageElement;

  glass = document.createElement('div');
  glass.id = 'magpoint-glass';
  glass.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:none;' +
    'background:rgba(93,140,255,0.055);' + // faint tint so the slab reads on flat white pages
    `backdrop-filter:blur(${opts.blur}px) saturate(${opts.saturate}%) brightness(1.06) url(#magpoint-lens)`;
  document.documentElement.appendChild(glass);

  rimSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  rimSvg.id = 'magpoint-rim';
  rimSvg.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:none;overflow:visible';
  const NS = 'http://www.w3.org/2000/svg';
  rimSvg.innerHTML =
    '<defs>' +
    '<linearGradient id="magpoint-rim-grad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#cfe0ff"/><stop offset="0.5" stop-color="#5b8cff"/><stop offset="1" stop-color="#2f6bff"/>' +
    '</linearGradient>' +
    '<radialGradient id="magpoint-rim-hot" gradientUnits="userSpaceOnUse" r="90">' +
    '<stop offset="0" stop-color="rgba(255,255,255,0.95)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>' +
    '</radialGradient>' +
    '</defs>';
  hotGrad = rimSvg.querySelector('radialGradient') as SVGRadialGradientElement;

  glowPath = document.createElementNS(NS, 'path');
  glowPath.setAttribute('fill', 'none');
  glowPath.setAttribute('stroke', '#3f7bff');
  glowPath.setAttribute('stroke-width', '7');
  glowPath.setAttribute('opacity', '0.45');
  glowPath.style.filter = 'blur(3px)';
  rimSvg.appendChild(glowPath);

  rimPath = document.createElementNS(NS, 'path');
  rimPath.setAttribute('fill', 'none');
  rimPath.setAttribute('stroke', 'url(#magpoint-rim-grad)');
  rimPath.setAttribute('stroke-width', '2');
  rimPath.style.filter = 'drop-shadow(0 6px 14px rgba(31,64,175,.35))';
  rimSvg.appendChild(rimPath);

  hotPath = document.createElementNS(NS, 'path');
  hotPath.setAttribute('fill', 'none');
  hotPath.setAttribute('stroke', 'url(#magpoint-rim-hot)');
  hotPath.setAttribute('stroke-width', '2.4');
  rimSvg.appendChild(hotPath);

  document.documentElement.appendChild(rimSvg);
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
        hideGlass();
      }
      showBadge(enabled ? 'MagPoint ON' : 'MagPoint OFF');
    }
  });

  requestAnimationFrame(frame);
  showBadge('MagPoint ON · Alt+M to toggle');
}
