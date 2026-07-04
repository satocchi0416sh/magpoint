// Title / caption / end cards for the launch video, rendered from HTML with
// headless Chrome (system fonts + full CSS control; ffmpeg drawtext avoided on
// purpose). Overlay pills are transparent PNGs; the end card is a full frame.
//
// Usage: node demo-studio/cards.mjs   → demo-studio/out/cards/*.png

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'demo-studio/out/cards');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const BASE = `
  * { margin: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .pill {
    display: inline-flex; align-items: baseline; gap: 18px;
    background: rgba(10, 15, 31, 0.84); border: 1.5px solid rgba(94, 140, 255, 0.55);
    border-radius: 22px; padding: 22px 38px;
    box-shadow: 0 0 34px rgba(63, 123, 255, 0.35), 0 10px 30px rgba(0, 0, 0, 0.4);
    color: #e8eefc;
  }
  .name { font-weight: 700; letter-spacing: 0.01em; }
  .dim { color: #9fb4e8; font-weight: 400; }
`;

// [file, width, height, transparent, html]
const CARDS = [
  ['title', 1560, 170, true,
    `<div class="pill" style="font-size:44px"><span class="name">MagPoint</span><span class="dim">a magnetic cursor for the web</span></div>`],
  ['cap-compare', 1200, 150, true,
    `<div class="pill" style="font-size:40px"><span class="name">same targets. no hunting.</span></div>`],
  ['cap-wikipedia', 1560, 150, true,
    `<div class="pill" style="font-size:38px"><span class="dim">snaps to the nearest clickable — on any page</span></div>`],
  ['cap-github', 1200, 150, true,
    `<div class="pill" style="font-size:38px"><span class="dim">works on the fiddly stuff</span></div>`],
  ['cap-mdn', 1760, 150, true,
    `<div class="pill" style="font-size:38px"><span class="dim">never grabs two targets — <span style="color:#e8eefc">bubble cursor (CHI 2005)</span></span></div>`],
  ['label-plain', 560, 130, true,
    `<div class="pill" style="font-size:36px"><span class="dim">plain cursor</span></div>`],
  ['label-mag', 560, 130, true,
    `<div class="pill" style="font-size:36px"><span class="name" style="color:#8fb0ff">MagPoint</span></div>`],
];

for (const [file, w, h, transparent, html] of CARDS) {
  render(file, w, h, transparent, `<body style="display:grid;place-items:center;width:${w}px;height:${h}px">${html}</body>`);
}

// end card: full frame, brand style (dark tile + luminous ring icon)
const iconSvg = execFileSync('node', [join(ROOT, 'scripts/make-icon.mjs')]).toString();
render('endcard', 2560, 1600, false, `
  <body style="width:2560px;height:1600px;display:grid;place-items:center;
               background:radial-gradient(ellipse at 50% 40%, #111a33 0%, #0a0f1f 70%)">
    <div style="display:flex;flex-direction:column;align-items:center;gap:44px">
      <div style="width:300px;height:300px;filter:drop-shadow(0 0 60px rgba(63,123,255,.45))">${iconSvg.replace('width="512" height="512"', 'width="300" height="300"')}</div>
      <div style="font-size:96px;font-weight:700;color:#e8eefc;letter-spacing:.01em">MagPoint</div>
      <div style="font-size:44px;color:#9fb4e8">github.com/satocchi0416sh/magpoint</div>
      <div style="font-size:36px;color:#5d739f">MIT · Chrome — coming soon</div>
    </div>
  </body>`);

function render(name, w, h, transparent, body) {
  const htmlPath = join(OUT, `${name}.html`);
  writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}</style></head>${body}</html>`);
  execFileSync(CHROME, [
    '--headless', '--disable-gpu',
    `--screenshot=${join(OUT, `${name}.png`)}`,
    `--window-size=${w},${h}`,
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `file://${htmlPath}`,
  ], { stdio: 'ignore' });
  console.log(`${name}.png ${w}x${h}`);
}
