// Assembles the launch video from raw scene cuts + cards.
//
//   beats: hook (HN) → before/after split (demo) → montage (wikipedia, github,
//          mdn) → end card, joined with short crossfades.
//   outputs: out/master.mp4 (2560x1600, YouTube/Store) and out/readme.mp4
//            (1280x800, aimed under GitHub's 10MB attachment limit).
//
// Usage: node demo-studio/scenes.mjs && node demo-studio/cards.mjs && node demo-studio/compose.mjs

import { mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'demo-studio/out');
const SCENES = join(OUT, 'scenes');
const CARDS = join(OUT, 'cards');
const BEATS = join(OUT, 'beats');
mkdirSync(BEATS, { recursive: true });

const W = 2560;
const H = 1600;
const XFADE = 0.35;

const ff = (args) => execFileSync('ffmpeg', ['-y', ...args], { stdio: 'ignore' });
const probe = (f) =>
  parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// ---- beat 1: hook — HN glide with the title pill fading in --------------------
ff([
  '-ss', '0.8', '-t', '6.8', '-i', join(SCENES, 'hn.mp4'),
  '-loop', '1', '-t', '6.8', '-i', join(CARDS, 'title.png'),
  '-filter_complex',
  `[1:v]format=rgba,fade=t=in:st=0.6:d=0.45:alpha=1[t];[0:v][t]overlay=72:${H}-overlay_h-72`,
  '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60',
  join(BEATS, '1-hook.mp4'),
]);

// ---- beat 2: before/after split ------------------------------------------------
ff([
  '-ss', '1.2', '-t', '8', '-i', join(SCENES, 'demo-off.mp4'),
  '-ss', '1.2', '-t', '8', '-i', join(SCENES, 'demo-on.mp4'),
  '-i', join(CARDS, 'label-plain.png'),
  '-i', join(CARDS, 'label-mag.png'),
  '-i', join(CARDS, 'cap-compare.png'),
  '-filter_complex',
  [
    `[0:v]scale=1272:795[l];[1:v]scale=1272:795[r];[l][r]hstack=inputs=2[row]`,
    `[row]pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:#0a0f1f[bg]`,
    `[bg][2:v]overlay=48:426[a]`,
    `[a][3:v]overlay=${8 + 1272 + 40}:426[b]`,
    `[4:v]format=rgba,fade=t=in:st=0.8:d=0.4:alpha=1[cap]`,
    `[b][cap]overlay=(${W}-overlay_w)/2:1252`,
  ].join(';'),
  '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60',
  join(BEATS, '2-compare.mp4'),
]);

// ---- beat 3: montage with caption pills ----------------------------------------
for (const [i, name] of [['3', 'wikipedia'], ['4', 'github'], ['5', 'mdn']]) {
  ff([
    '-ss', '1.5', '-t', '6.5', '-i', join(SCENES, `${name}.mp4`),
    '-loop', '1', '-t', '6.5', '-i', join(CARDS, `cap-${name}.png`),
    '-filter_complex',
    `[1:v]format=rgba,fade=t=in:st=0.4:d=0.4:alpha=1[t];[0:v][t]overlay=72:${H}-overlay_h-72`,
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60',
    join(BEATS, `${i}-${name}.mp4`),
  ]);
}

// ---- beat 6: end card ------------------------------------------------------------
ff([
  '-loop', '1', '-t', '3.5', '-i', join(CARDS, 'endcard.png'),
  '-vf', `scale=${W}:${H},fade=t=in:st=0:d=0.5`,
  '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60',
  join(BEATS, '6-end.mp4'),
]);

// ---- xfade chain → master ----------------------------------------------------------
const beats = ['1-hook', '2-compare', '3-wikipedia', '4-github', '5-mdn', '6-end'].map((b) => join(BEATS, `${b}.mp4`));
const durs = beats.map(probe);
let filter = '';
let prev = '[0:v]';
let offset = 0;
for (let i = 1; i < beats.length; i++) {
  offset += durs[i - 1] - XFADE;
  const label = i === beats.length - 1 ? '[v]' : `[x${i}]`;
  filter += `${prev}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}${label};`;
  prev = `[x${i}]`;
}
ff([
  ...beats.flatMap((b) => ['-i', b]),
  '-filter_complex', filter.slice(0, -1),
  '-map', '[v]',
  '-c:v', 'libx264', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '60',
  join(OUT, 'master.mp4'),
]);

// ---- readme cut: 1280x800, tuned to sit under GitHub's 10MB attachment cap ---------
ff([
  '-i', join(OUT, 'master.mp4'),
  '-vf', 'scale=1280:800',
  '-c:v', 'libx264', '-crf', '24', '-pix_fmt', 'yuv420p',
  join(OUT, 'readme.mp4'),
]);

const mb = (f) => Math.round((statSync(f).size / 1048576) * 100) / 100;
console.log(JSON.stringify({
  master: { file: 'demo-studio/out/master.mp4', seconds: Math.round(probe(join(OUT, 'master.mp4'))), mb: mb(join(OUT, 'master.mp4')) },
  readme: { file: 'demo-studio/out/readme.mp4', mb: mb(join(OUT, 'readme.mp4')) },
}));
