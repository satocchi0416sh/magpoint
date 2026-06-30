/**
 * MagPoint — magnetic cursor engine (Phase 0.1, liquid).
 *
 * Selection (the part that decides what gets clicked) is the bubble cursor
 * (Grossman & Balakrishnan, CHI 2005): each frame capture the clickable element
 * with the smallest point-to-rectangle distance, within `maxRadius`. Provably
 * distractor-robust — never grabs two targets at once.
 *
 * Presentation is decoupled and purely cosmetic: a liquid "mercury" cursor that
 * springs onto the captured target (with overshoot + squash/stretch) and stays
 * tethered to the physical pointer by a metaball bridge that thins as it
 * stretches. Hit-test never depends on the animation, so the goo can't mis-click.
 *
 * Metaball connector: Hiroyuki Sato's algorithm, params per https://varun.ca/metaballs/
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

const ACCENT = '40, 110, 255';

const opts = {
  maxRadius: 120, // R_max: don't snap to far targets; preserves empty-space clicks
  // liquid cursor
  ghostR: 5, // radius at the physical-pointer end of the bridge
  headR: 9, // radius of the magnet head that sits on the target
  spring: { k: 0.14, zeta: 0.72 }, // zeta < 1 => overshoot ("プニッ")
  squash: { gain: 0.045, max: 0.6 }, // velocity-driven stretch along motion
  handleLenRate: 2.4, // metaball curviness
  v: 0.5, // metaball tangent spread
};

let candidates: Candidate[] = [];
let raw: Pt = [-1, -1]; // physical pointer
const head = { x: -1, y: -1, vx: 0, vy: 0 }; // eased magnet head
let captured: Candidate | null = null;
let wasCaptured = false;
let enabled = true;
let dirty = true;
let dpr = 1;

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

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
    if (el === (canvas as unknown as HTMLElement)) return;
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

// ---- liquid rendering -----------------------------------------------------

/**
 * Metaball bridge between circle A (a, r1) and circle B (b, r2).
 * Returns false (draw nothing) when one circle contains the other.
 * Hiroyuki Sato's construction; tangent points + perpendicular handles.
 */
function metaball(a: Pt, r1: number, b: Pt, r2: number): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  if (d === 0 || d <= Math.abs(r1 - r2)) return;
  const total = r1 + r2;

  let u1 = 0;
  let u2 = 0;
  if (d < total) {
    u1 = Math.acos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d));
    u2 = Math.acos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d));
  }
  const angle = Math.atan2(dy, dx);
  const maxSpread = Math.acos((r1 - r2) / d);
  const { v } = opts;

  const a1 = angle + u1 + (maxSpread - u1) * v;
  const a2 = angle - u1 - (maxSpread - u1) * v;
  const a3 = angle + Math.PI - u2 - (Math.PI - u2 - maxSpread) * v;
  const a4 = angle - Math.PI + u2 + (Math.PI - u2 - maxSpread) * v;

  const onCircle = (c: Pt, r: number, ang: number): Pt => [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
  const p1 = onCircle(a, r1, a1);
  const p2 = onCircle(a, r1, a2);
  const p3 = onCircle(b, r2, a3);
  const p4 = onCircle(b, r2, a4);

  const dist = (m: Pt, n: Pt) => Math.hypot(m[0] - n[0], m[1] - n[1]);
  const d2 = Math.min(v * opts.handleLenRate, dist(p1, p3) / total) * Math.min(1, (d * 2) / total);
  const r1h = r1 * d2;
  const r2h = r2 * d2;

  const handle = (p: Pt, ang: number, len: number, sign: number): Pt => [
    p[0] + Math.cos(ang + (sign * Math.PI) / 2) * len,
    p[1] + Math.sin(ang + (sign * Math.PI) / 2) * len,
  ];
  const h1 = handle(p1, a1, r1h, 1);
  const h2 = handle(p2, a2, r1h, -1);
  const h3 = handle(p3, a3, r2h, -1);
  const h4 = handle(p4, a4, r2h, 1);

  ctx.moveTo(p1[0], p1[1]);
  ctx.bezierCurveTo(h1[0], h1[1], h3[0], h3[1], p3[0], p3[1]);
  ctx.lineTo(p4[0], p4[1]);
  ctx.bezierCurveTo(h4[0], h4[1], h2[0], h2[1], p2[0], p2[1]);
  ctx.closePath();
}

function render(): void {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!captured) return;
  const r = captured.rect;

  // highlight the captured element
  ctx.save();
  ctx.strokeStyle = `rgba(${ACCENT}, 0.9)`;
  ctx.lineWidth = 2;
  const x = r.left - 4;
  const y = r.top - 4;
  const w = r.width + 8;
  const h = r.height + 8;
  const rad = 8;
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.stroke();
  ctx.restore();

  // distance pointer -> head, used to taper the tail so it thins as it stretches
  const dx = head.x - raw[0];
  const dy = head.y - raw[1];
  const dHead = Math.hypot(dx, dy);
  const t = Math.min(1, dHead / opts.maxRadius);
  const ghostR = opts.ghostR * (1 - 0.85 * t); // tail wisp shrinks with stretch

  // squash & stretch the head along its velocity
  const speed = Math.hypot(head.vx, head.vy);
  const stretch = 1 + Math.min(opts.squash.max, speed * opts.squash.gain);
  const squash = 1 / stretch;
  const vAng = Math.atan2(head.vy, head.vx);

  // one liquid mass: bridge + ghost + head, filled together so they merge
  ctx.save();
  ctx.fillStyle = `rgba(${ACCENT}, 1)`;
  ctx.shadowColor = `rgba(${ACCENT}, 0.45)`;
  ctx.shadowBlur = 10;

  ctx.beginPath();
  metaball([raw[0], raw[1]], ghostR, [head.x, head.y], opts.headR);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(raw[0], raw[1], ghostR, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(head.x, head.y, opts.headR * stretch, opts.headR * squash, vAng, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // white core so the head reads as a cursor
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// ---- main loop ------------------------------------------------------------

function springTo(tx: number, ty: number): void {
  const { k, zeta } = opts.spring;
  const c = 2 * Math.sqrt(k) * zeta;
  head.vx += k * (tx - head.x) - c * head.vx;
  head.vy += k * (ty - head.y) - c * head.vy;
  head.x += head.vx;
  head.y += head.vy;
}

function frame(): void {
  if (enabled && raw[0] >= 0) {
    if (dirty) {
      collect();
      dirty = false;
    }
    captured = suppressed() ? null : nearest(raw[0], raw[1]);

    // on a fresh capture, seed the head at the pointer so it leaps onto the target
    if (captured && !wasCaptured) {
      head.x = raw[0];
      head.y = raw[1];
      head.vx = 0;
      head.vy = 0;
    }
    wasCaptured = !!captured;

    if (captured) {
      springTo(captured.rect.left + captured.rect.width / 2, captured.rect.top + captured.rect.height / 2);
    }

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

function resizeCanvas(): void {
  dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function showBadge(text: string): void {
  let badge = document.getElementById('magpoint-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'magpoint-badge';
    badge.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:6px 12px;' +
      'border-radius:999px;font:600 12px/1 system-ui,sans-serif;color:#fff;' +
      `background:rgba(${ACCENT},.95);pointer-events:none;transition:opacity .3s;box-shadow:0 2px 8px rgba(0,0,0,.2)`;
    document.documentElement.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.opacity = '1';
  window.setTimeout(() => {
    if (badge) badge.style.opacity = '0';
  }, 1200);
}

export function startMagnet(): void {
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none';
  ctx = canvas.getContext('2d')!;
  document.documentElement.appendChild(canvas);
  resizeCanvas();

  const style = document.createElement('style');
  style.textContent = 'html.magpoint-snapping, html.magpoint-snapping * { cursor: none !important; }';
  document.documentElement.appendChild(style);

  addEventListener('mousemove', (e) => {
    raw = [e.clientX, e.clientY];
  }, true);

  addEventListener('scroll', () => (dirty = true), true);
  addEventListener('resize', () => {
    resizeCanvas();
    dirty = true;
  });

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
        ctx.clearRect(0, 0, innerWidth, innerHeight);
      }
      showBadge(enabled ? 'MagPoint ON' : 'MagPoint OFF');
    }
  });

  requestAnimationFrame(frame);
  showBadge('MagPoint ON · Alt+M to toggle');
}
