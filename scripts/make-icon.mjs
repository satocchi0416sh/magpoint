// Generates the MagPoint icon as SVG using the same perimeter-deform math as
// lib/magnet.ts: a liquid-glass ring bulging toward a cursor in the corner.
// Render to PNG with: node scripts/make-icon.mjs > /tmp/icon.svg (then rasterize).

const S = 512; // canvas
const FRAME = { x: 96, y: 96, w: 320, h: 320, r: 88 };
const CURSOR = [432, 432]; // bulge target, bottom-right
const BULGE = { A: 34, sigma: 110, R: 260 };
const STROKE = 52;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function roundRectPerimeter(x, y, w, h, r, N) {
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const sh = w - 2 * r;
  const sv = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const total = 2 * sh + 2 * sv + 4 * arc;
  const pts = [];
  const mk = (px, py, nx, ny) => ({ x: px, y: py, nx, ny });
  for (let i = 0; i < N; i++) {
    let seg = (i / N) * total;
    if (seg < sh) { pts.push(mk(x + r + seg, y, 0, -1)); continue; }
    seg -= sh;
    if (seg < arc) { const a = -Math.PI / 2 + (seg / arc) * (Math.PI / 2); pts.push(mk(x + w - r + Math.cos(a) * r, y + r + Math.sin(a) * r, Math.cos(a), Math.sin(a))); continue; }
    seg -= arc;
    if (seg < sv) { pts.push(mk(x + w, y + r + seg, 1, 0)); continue; }
    seg -= sv;
    if (seg < arc) { const a = (seg / arc) * (Math.PI / 2); pts.push(mk(x + w - r + Math.cos(a) * r, y + h - r + Math.sin(a) * r, Math.cos(a), Math.sin(a))); continue; }
    seg -= arc;
    if (seg < sh) { pts.push(mk(x + w - r - seg, y + h, 0, 1)); continue; }
    seg -= sh;
    if (seg < arc) { const a = Math.PI / 2 + (seg / arc) * (Math.PI / 2); pts.push(mk(x + r + Math.cos(a) * r, y + h - r + Math.sin(a) * r, Math.cos(a), Math.sin(a))); continue; }
    seg -= arc;
    if (seg < sv) { pts.push(mk(x, y + h - r - seg, -1, 0)); continue; }
    seg -= sv;
    { const a = Math.PI + (seg / arc) * (Math.PI / 2); pts.push(mk(x + r + Math.cos(a) * r, y + r + Math.sin(a) * r, Math.cos(a), Math.sin(a))); }
  }
  return pts;
}

function deform(pts, cursor, p) {
  const d2s = pts.map((pt) => (pt.x - cursor[0]) ** 2 + (pt.y - cursor[1]) ** 2);
  const bestD2 = Math.min(...d2s);
  const proximity = clamp(1 - Math.sqrt(bestD2) / p.R, 0, 1);
  const twoSigma2 = 2 * p.sigma * p.sigma;
  return pts.map((pt, i) => {
    const bulge = p.A * Math.exp(-(d2s[i] - bestD2) / twoSigma2) * proximity;
    return [pt.x + pt.nx * bulge, pt.y + pt.ny * bulge];
  });
}

function catmullRomClosed(pts) {
  const n = pts.length;
  const f = (v) => Math.round(v * 100) / 100;
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C ${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}, ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)}, ${f(p2[0])} ${f(p2[1])} `;
  }
  return d + 'Z';
}

const perim = roundRectPerimeter(FRAME.x, FRAME.y, FRAME.w, FRAME.h, FRAME.r, 200);
const ring = catmullRomClosed(deform(perim, CURSOR, BULGE));

// macOS-style arrow, tip at the bulge target
const arrow = `M 0 0 L 0 30.2 L 7.2 23.5 L 12.1 34.4 L 17.5 32 L 12.6 21.2 L 22.4 20.2 Z`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d6e4ff"/>
      <stop offset="0.4" stop-color="#4e8aff"/>
      <stop offset="0.6" stop-color="#2c68ec"/>
      <stop offset="1" stop-color="#143cb0"/>
    </linearGradient>
  </defs>
  <path d="${ring}" fill="none" stroke="#0b1c4a" stroke-width="${STROKE + 14}" opacity="0.9"/>
  <path d="${ring}" fill="none" stroke="url(#metal)" stroke-width="${STROKE}"/>
  <path d="${ring}" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="6"
        transform="translate(0,-${STROKE / 2 - 5})" opacity="0.8"/>
  <g transform="translate(${CURSOR[0] - 11},${CURSOR[1] - 17}) scale(2.6)">
    <path d="${arrow}" fill="#ffffff" stroke="#0b1c4a" stroke-width="2.6" stroke-linejoin="round"/>
  </g>
</svg>`;

process.stdout.write(svg);
