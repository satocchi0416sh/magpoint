// Scene lineup for the launch video (owner-approved: logged-out public pages
// of Wikipedia / HN / MDN / a public GitHub repo, plus the bundled demo page).
//
// Usage: npm run build && node demo-studio/scenes.mjs [name ...]   (no args = all)
// Raw cuts land in demo-studio/out/scenes/<name>.mp4 — composition is compose.mjs.

import { recordScene } from './record.mjs';
import { spawn } from 'node:child_process';

export const SCENES = [
  // beat 1 — the hook: glass leaping between 10px upvote arrows from the margin
  { name: 'hn', url: 'https://news.ycombinator.com', selector: '.votearrow', approach: 'left' },

  // beat 2 — before/after on our own demo page (tiny checkboxes; zero rights risk)
  { name: 'demo-on', url: 'http://localhost:8747/demo/index.html', selector: '.tiny input', extension: true },
  { name: 'demo-off', url: 'http://localhost:8747/demo/index.html', selector: '.tiny input', extension: false, hunt: true },

  // beat 3 — montage across recognizable, text-dense real pages
  { name: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Fitts%27s_law' },
  // issues list, not the repo root: the file tree there is one giant tabindex
  // container, and the bubble cursor (correctly) captures it — terrible on camera
  { name: 'github', url: 'https://github.com/microsoft/vscode/issues', hideCss: '.js-consent-banner,#js-cookie-consent-banner' },
  // .place/.pong = MDN's ad placements — a third-party ad (GitLab, of all things)
  // once landed at the top of a take; never ship someone else's ad in our video
  // ads + partner promos rotate per load (GitLab ad / Scrimba strip observed);
  // hide every placement-ish container — cosmetic, recording only
  { name: 'mdn', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS', hideCss: '.top-banner,#mdn-cta,.place,.pong,.pong-box,[class*="banner"]' },
];

const only = process.argv.slice(2);
const list = only.length ? SCENES.filter((s) => only.includes(s.name)) : SCENES;

// bundled demo page needs a local server
let server = null;
if (list.some((s) => s.url.includes('localhost:8747'))) {
  server = spawn('python3', ['-m', 'http.server', '8747', '--directory', new URL('..', import.meta.url).pathname], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
}

try {
  for (const scene of list) {
    const res = await recordScene(scene);
    console.log(JSON.stringify(res));
  }
} finally {
  server?.kill();
}
