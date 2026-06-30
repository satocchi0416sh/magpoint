/**
 * MagPoint — magnetic cursor engine (Phase 0).
 *
 * Core logic stolen from the bubble cursor (Grossman & Balakrishnan, CHI 2005):
 * every frame we capture the single clickable element with the smallest
 * point-to-rectangle distance to the pointer (== the Voronoi cell the cursor is
 * in), as long as it's within `maxRadius`. This is provably distractor-robust:
 * it can never grab two targets at once, so dense link-heavy pages stay sane.
 *
 * The drawn cursor eases toward the captured target (delight), while the real
 * hit-test stays exact and clicks are re-routed to the captured element
 * (so you can't miss). Pull and hit-test are decoupled — the animation can
 * never cause a mis-click.
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

const opts = {
  maxRadius: 120, // R_max: don't snap to far targets; preserves empty-space clicks
  ease: 0.25, // lerp factor for the drawn cursor
};

let candidates: Candidate[] = [];
let raw = { x: -1, y: -1 }; // physical pointer
let drawn = { x: -1, y: -1 }; // eased magnet cursor
let captured: Candidate | null = null;
let enabled = true;
let dirty = true; // candidate list needs refresh
let dpr = 1;

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

// ---- geometry -------------------------------------------------------------

/** Shortest distance from a point to a rectangle (0 if inside) — the paper's nearest-edge metric. */
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
  if (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > innerHeight ||
    rect.left > innerWidth
  ) {
    return false;
  }
  const s = getComputedStyle(el);
  if (
    s.visibility === 'hidden' ||
    s.display === 'none' ||
    s.pointerEvents === 'none' ||
    Number(s.opacity) === 0
  ) {
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

/** Magnet stands down while the user is typing or has a text selection. */
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

// ---- rendering ------------------------------------------------------------

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function render(): void {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!captured) return;
  const r = captured.rect;

  // highlight the captured element
  ctx.strokeStyle = 'rgba(56, 132, 255, 0.95)';
  ctx.lineWidth = 2;
  roundRect(ctx, r.left - 4, r.top - 4, r.width + 8, r.height + 8, 8);
  ctx.stroke();

  // elastic line from physical pointer to the snapped cursor — shows the "pull"
  ctx.strokeStyle = 'rgba(56, 132, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(raw.x, raw.y);
  ctx.lineTo(drawn.x, drawn.y);
  ctx.stroke();

  // ghost at the real pointer
  ctx.fillStyle = 'rgba(56, 132, 255, 0.35)';
  ctx.beginPath();
  ctx.arc(raw.x, raw.y, 4, 0, Math.PI * 2);
  ctx.fill();

  // the magnet cursor itself
  ctx.fillStyle = 'rgba(40, 110, 255, 1)';
  ctx.beginPath();
  ctx.arc(drawn.x, drawn.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---- main loop ------------------------------------------------------------

function frame(): void {
  if (enabled && raw.x >= 0) {
    if (dirty) {
      collect();
      dirty = false;
    }
    captured = suppressed() ? null : nearest(raw.x, raw.y);

    if (captured) {
      const cx = captured.rect.left + captured.rect.width / 2;
      const cy = captured.rect.top + captured.rect.height / 2;
      drawn.x += (cx - drawn.x) * opts.ease;
      drawn.y += (cy - drawn.y) * opts.ease;
    } else {
      drawn.x = raw.x;
      drawn.y = raw.y;
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
  if (el.contains(e.target as Node)) return; // already landing on it
  e.preventDefault();
  e.stopImmediatePropagation();
  el.focus?.();
  el.click(); // untrusted → ignored by this handler (isTrusted guard)
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
  // overlay canvas
  canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none';
  ctx = canvas.getContext('2d')!;
  document.documentElement.appendChild(canvas);
  resizeCanvas();

  // hide the real cursor only while snapping
  const style = document.createElement('style');
  style.textContent =
    'html.magpoint-snapping, html.magpoint-snapping * { cursor: none !important; }';
  document.documentElement.appendChild(style);

  addEventListener('mousemove', (e) => {
    raw.x = e.clientX;
    raw.y = e.clientY;
  }, true);

  addEventListener('scroll', () => (dirty = true), true);
  addEventListener('resize', () => {
    resizeCanvas();
    dirty = true;
  });

  const mo = new MutationObserver(() => (dirty = true));
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  document.addEventListener('click', onClick, true);

  // Alt+M toggles the magnet
  addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      enabled = !enabled;
      if (!enabled) {
        captured = null;
        document.documentElement.classList.remove('magpoint-snapping');
        ctx.clearRect(0, 0, innerWidth, innerHeight);
      }
      showBadge(enabled ? 'MagPoint ON' : 'MagPoint OFF');
    }
  });

  requestAnimationFrame(frame);
  showBadge('MagPoint ON · Alt+M to toggle');
}
