// Chrome Web Store listing assets, regenerable from the shot scenes:
//   - 5 screenshots (1280x800 PNG) picked from scene/beat footage
//   - small promo tile 440x280 + marquee 1400x560 (brand style)
//
// Usage: node demo-studio/scenes.mjs && node demo-studio/compose.mjs && node demo-studio/store.mjs
// Output: demo-studio/out/store/

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'demo-studio/out');
const STORE = join(OUT, 'store');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(STORE, { recursive: true });

// ---- screenshots: best moments, scaled to the Store's 1280x800 -----------------
const SHOTS = [
  ['shot-1-hn', join(OUT, 'scenes/hn.mp4'), 4.2],
  ['shot-2-compare', join(OUT, 'beats/2-compare.mp4'), 5.0],
  ['shot-3-wikipedia', join(OUT, 'scenes/wikipedia.mp4'), 5.5],
  ['shot-4-github', join(OUT, 'scenes/github.mp4'), 6.0],
  ['shot-5-demo', join(OUT, 'scenes/demo-on.mp4'), 6.0],
];
for (const [name, src, t] of SHOTS) {
  execFileSync('ffmpeg', ['-y', '-ss', String(t), '-i', src, '-vf', 'scale=1280:800', '-frames:v', '1', join(STORE, `${name}.png`)], { stdio: 'ignore' });
  console.log(`${name}.png 1280x800`);
}

// ---- promo tiles: dark + luminous, consistent with the icon/end card -----------
const iconSvg = execFileSync('node', [join(ROOT, 'scripts/make-icon.mjs')]).toString();
const BASE = `
  * { margin: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased;
         background: radial-gradient(ellipse at 50% 35%, #111a33 0%, #0a0f1f 75%); }
  .name { font-weight: 700; color: #e8eefc; letter-spacing: .01em; }
  .tag { color: #9fb4e8; }
`;
const tile = (w, h, icon, name, tag) => `
  <body style="width:${w}px;height:${h}px;display:grid;place-items:center">
    <div style="display:flex;align-items:center;gap:${Math.round(h * 0.09)}px">
      <div style="width:${icon}px;height:${icon}px;filter:drop-shadow(0 0 ${Math.round(icon * 0.14)}px rgba(63,123,255,.5))">
        ${iconSvg.replace('width="512" height="512"', `width="${icon}" height="${icon}"`)}
      </div>
      <div>
        <div class="name" style="font-size:${Math.round(h * 0.17)}px">${name}</div>
        <div class="tag" style="font-size:${Math.round(h * 0.085)}px">${tag}</div>
      </div>
    </div>
  </body>`;

const TILES = [
  ['tile-small-440x280', 440, 280, tile(440, 280, 128, 'MagPoint', 'a magnetic cursor<br>for the web')],
  ['tile-marquee-1400x560', 1400, 560, tile(1400, 560, 300, 'MagPoint', 'a magnetic cursor for the web')],
];
for (const [name, w, h, body] of TILES) {
  const htmlPath = join(STORE, `${name}.html`);
  writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}</style></head>${body}</html>`);
  execFileSync(CHROME, ['--headless', '--disable-gpu', `--screenshot=${join(STORE, `${name}.png`)}`, `--window-size=${w},${h}`, `file://${htmlPath}`], { stdio: 'ignore' });
  console.log(`${name}.png`);
}
