// demo-studio spike: can we record a convincing MagPoint demo with zero hands?
//
// Loads the built extension into real Chrome, injects a fake macOS cursor that
// follows a scripted humanized path (synthetic mousemove drives the extension;
// the OS cursor doesn't move under CDP, hence the overlay), captures the tab via
// CDP screencast, and assembles an .mp4 with ffmpeg.
//
// Usage: npm run build && node demo-studio/spike.mjs [url] [targetSelector] [outName]
//   e.g. node demo-studio/spike.mjs https://news.ycombinator.com .votearrow hn
// Output: demo-studio/out/<outName>.mp4 (default: spike)

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, '.output/chrome-mv3');
const OUT = join(ROOT, 'demo-studio/out');
const FRAMES = join(OUT, 'frames');
// NOTE: use Playwright's Chromium — branded Google Chrome (137+) ignores --load-extension.
const PAGE = process.argv[2] ?? 'https://en.wikipedia.org/wiki/Fitts%27s_law';
const SELECTOR = process.argv[3] ?? 'a[href]';
const OUTNAME = process.argv[4] ?? 'spike';
// approach direction for the off-target dwell: 'path' = 42px short along the travel
// direction; 'left' = from the left margin (for leftmost targets like HN vote arrows,
// where a path-side dwell would legitimately capture the adjacent title link instead)
const APPROACH = process.argv[5] ?? 'path';
const W = 1280;
const H = 800;

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const context = await chromium.launchPersistentContext(join(OUT, 'profile'), {
  headless: true, // new headless supports extensions — and a real mouse can't wander into the shot
  channel: 'chromium', // full Chromium; the default headless shell can't load extensions
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  args: [
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    '--force-device-scale-factor=2', // retina capture: screencast frames come out at 2x
    '--hide-crash-restore-bubble',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
// hide fundraiser/site notices — they hijack the frame
await page.addStyleTag({
  content: '#siteNotice, #centralNotice, .frb, #frb-inline, .cn-banner { display: none !important; }',
});
await page.waitForTimeout(2500); // let the page settle + extension badge fade
const injected = await page.evaluate(() => !!document.getElementById('magpoint-glass'));
if (!injected) throw new Error('extension not injected — check --load-extension support');

// ---- CDP screencast (armed before the tour so frame 1 is the resting state) ----
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', (f) => {
  frames.push({ ts: f.metadata.timestamp });
  writeFileSync(join(FRAMES, `f${String(frames.length).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 92,
  everyNthFrame: 1,
  maxWidth: W * 2, // retina: capture the dsf-2 surface, not the CSS-px window size
  maxHeight: H * 2,
});
await page.waitForTimeout(400);

// ---- fake cursor + humanized tour, all in-page for frame-exact timing ----
const linkCount = await page.evaluate(async ({ SEL, MODE }) => {
  const cur = document.createElement('div');
  cur.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:26px;height:38px';
  cur.innerHTML =
    '<svg viewBox="0 0 26 38" width="26" height="38"><path d="M 1 1 L 1 27.2 L 7.5 21.1 L 11.9 31 L 16.8 28.8 L 12.4 19 L 21.3 18.1 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(cur);

  const mv = (x, y) => {
    cur.style.left = x - 1 + 'px';
    cur.style.top = y - 1 + 'px';
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
  };

  // waypoints: visible targets spread across the upper viewport
  const links = [...document.querySelectorAll(SEL)].filter((a) => {
    const r = a.getBoundingClientRect();
    return r.width > 7 && r.height > 7 && r.top > 60 && r.bottom < 640 && r.left > 10 && r.right < 1250;
  });
  const pick = [0.12, 0.3, 0.5, 0.68, 0.85].map((f) => links[Math.floor(f * links.length)]).filter(Boolean);
  const pts = pick.map((a) => {
    const r = a.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  const animate = async (from, to, ms) => {
    // slight arc via a perpendicular control point — straight lines look robotic
    const mx = (from[0] + to[0]) / 2;
    const my = (from[1] + to[1]) / 2;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const c = [mx - (dy / len) * len * 0.12, my + (dx / len) * len * 0.12];
    const t0 = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = ease(t);
      const u = 1 - e;
      mv(u * u * from[0] + 2 * u * e * c[0] + e * e * to[0], u * u * from[1] + 2 * u * e * c[1] + e * e * to[1]);
      if (t >= 1) return;
      await nextFrame();
    }
  };

  let pos = [640, 420];
  mv(...pos);
  await new Promise((r) => setTimeout(r, 600));
  for (const p of pts) {
    // pause just short of the target first — the frame stretches out to meet
    // the cursor, which is the whole "magnet" money shot
    const dx = p[0] - pos[0];
    const dy = p[1] - pos[1];
    const len = Math.hypot(dx, dy) || 1;
    const near = MODE === 'left' ? [p[0] - 46, p[1] + 14] : [p[0] - (dx / len) * 42, p[1] - (dy / len) * 42];
    await animate(pos, near, 220 + len * 1.4);
    await new Promise((r) => setTimeout(r, 550)); // hover off-target: stretched reach
    await animate(near, p, 240);
    pos = p;
    await new Promise((r) => setTimeout(r, 600)); // settle on the target
  }
  await new Promise((r) => setTimeout(r, 500));
  return pts.length;
}, { SEL: SELECTOR, MODE: APPROACH });

await page.waitForTimeout(400);
await cdp.send('Page.stopScreencast');
await context.close();

// ---- assemble: exact per-frame durations via concat demuxer ----
let concat = '';
for (let i = 0; i < frames.length; i++) {
  const dur = i + 1 < frames.length ? frames[i + 1].ts - frames[i].ts : 1 / 30;
  concat += `file 'frames/f${String(i + 1).padStart(5, '0')}.jpg'\nduration ${Math.max(dur, 0.001).toFixed(4)}\n`;
}
writeFileSync(join(OUT, 'concat.txt'), concat);
execFileSync('ffmpeg', [
  '-y', '-f', 'concat', '-safe', '0', '-i', join(OUT, 'concat.txt'),
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=60',
  '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
  join(OUT, `${OUTNAME}.mp4`),
], { stdio: 'ignore' });

const fps = frames.length / (frames[frames.length - 1].ts - frames[0].ts);
console.log(JSON.stringify({ frames: frames.length, effectiveFps: Math.round(fps), waypoints: linkCount, out: `demo-studio/out/${OUTNAME}.mp4` }));
