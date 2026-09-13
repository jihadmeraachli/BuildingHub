#!/usr/bin/env node
/**
 * Record the teaser reel as an uploadable bilingual MP4:
 *   English cut -> "Abniyah / Coming soon" -> Arabic cut -> "أبنية / قريباً"
 *
 * Companion to bake-reel.mjs. That one embeds photos into the reel; this one
 * turns the reel (baked or not) into the file you actually hand to Instagram.
 *
 *   node scripts/shoot-reel-bilingual.mjs --out dist/reel
 *
 * Needs ffmpeg. Set FFMPEG to a binary path, or have it on PATH. Playwright is
 * already a devDependency; `npx playwright install chromium` if it is missing.
 *
 * ── Two things this has to get right, both learned the hard way ─────────────
 *
 * 1. NO REVIEW CHROME. assets/marketing/reel/index.html is a studio page —
 *    header, lede, control buttons, production notes — with the ad itself as a
 *    small card in the middle. Only the card goes in the video. The page
 *    already has the right mode for this (`.stage.faux-full` + `body.faux-lock`:
 *    fixed, full height, black letterbox, type re-scaled in vh), so RECORD_CSS
 *    below mirrors those rules rather than inventing its own fullscreen.
 *
 *    An earlier pass injected hand-rolled CSS from an init script that read
 *    `document.documentElement.appendChild(...)` at document-start.
 *    documentElement can still be null that early: the script threw, the CSS
 *    never mounted, and every frame of both cuts shipped with the chrome in
 *    it. Hence the null-safe retry in mount().
 *
 * 2. NO MID-BEAT LEAD-IN. Recording starts when the browser context is
 *    created — before the page has even navigated — and the stage auto-plays
 *    the moment it parses. So the stage is held invisible behind an
 *    `html[data-rec="go"]` gate until the language is set and the animation
 *    has been restarted from frame 0. That makes the lead-in pure black, which
 *    ffmpeg's blackdetect then trims off exactly.
 */
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REEL = pathToFileURL(path.join(ROOT, 'assets/marketing/reel/index.html')).href;

const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > -1 ? process.argv[outArg + 1] : 'dist/reel');

/** 540x960 is exactly 9:16, so the 9:16 stage fills it with no letterbox. */
const VIEWPORT = { width: 540, height: 960 };
/** Long enough for the reel (~10.2s) plus a hold on the end card. */
const RECORD_SECONDS = 13;
/** Per cut in the final file: the reel, then ~1.8s on the end card. */
const CUT_SECONDS = 12;

const RECORD_CSS = `
  html, body { background: #000 !important; margin: 0 !important; overflow: hidden !important; }
  .wrap { max-width: none !important; margin: 0 !important; padding: 0 !important; }
  .wrap > header, .controls, .slots, .note { display: none !important; }
  .studio { margin: 0 !important; gap: 0 !important; }
  .stage {
    position: fixed !important; inset: 0 !important; margin: auto !important;
    width: auto !important; height: 100vh !important; max-width: none !important;
    border-radius: 0 !important; padding: 0 !important; z-index: 9999 !important;
    box-shadow: none !important;
  }
  .stage .frame { inset: 7% !important; }
  .stage .problem { font-size: clamp(28px, 4.6vh, 74px) !important; }
  .stage .mark { font-size: clamp(30px, 5.4vh, 88px) !important; }
  .stage .soon { font-size: clamp(11px, 1.5vh, 22px) !important; padding: .6vh 1.4vh !important; }
  .stage .tag { font-size: clamp(12px, 1.7vh, 26px) !important; }
  .stage .problem span.bar { height: .45vh !important; }
  /* the progress hairline and the exit button are review chrome, not the ad */
  .stage .track, .exit { display: none !important; }

  /* the black hold, lifted only once the cut is cued */
  .stage { visibility: hidden !important; }
  html[data-rec="go"] .stage { visibility: visible !important; }
`;

async function recordCut(browser, arabic, tag) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUT, size: VIEWPORT },
  });
  const page = await ctx.newPage();

  // document-start, null-safe: documentElement may not exist on the first tick.
  await page.addInitScript((css) => {
    const mount = () => {
      const root = document.head || document.documentElement;
      if (!root) return false;
      if (document.getElementById('__rec_css')) return true;
      const s = document.createElement('style');
      s.id = '__rec_css';
      s.textContent = css;
      root.appendChild(s);
      return true;
    };
    if (!mount()) {
      const t = setInterval(() => { if (mount()) clearInterval(t); }, 0);
    }
  }, RECORD_CSS);

  await page.goto(REEL);
  // 'attached', not the default 'visible' — the black hold keeps it invisible.
  await page.waitForSelector('#stage', { state: 'attached' });

  // The page's own fullscreen mode. Toggle the classes directly rather than
  // clicking #full, which prefers the native Fullscreen API — unreliable headless.
  await page.evaluate(() => {
    document.getElementById('stage').classList.add('faux-full');
    document.body.classList.add('faux-lock');
  });

  if (arabic) {
    // #lang flips the language and re-renders. Done while the stage is still
    // held invisible, so the switch itself never reaches the video.
    await page.evaluate(() => document.getElementById('lang').click());
    await page.waitForTimeout(300);
  }

  // Confirm what is on the stage before committing 13s of recording to it.
  const beats = await page.evaluate(() =>
    [...document.querySelectorAll('.problem .txt')].map((el) => el.textContent));
  console.log(`  ${tag} beats: ${JSON.stringify(beats, null, 0)}`);

  // Cue: reveal and restart from frame 0 in the same tick.
  await page.evaluate(() => {
    document.documentElement.dataset.rec = 'go';
    play();
  });
  await page.waitForTimeout(RECORD_SECONDS * 1000);

  await ctx.close();
  const file = await page.video().path();
  console.log(`  ${tag} recorded -> ${path.basename(file)}`);
  return file;
}

/**
 * Length of the pure-black hold at the head of a cut, so it can be trimmed.
 * pix_th=0.05 sits below the stage's dark-teal ground (~0.11 luma), so the
 * reel's own background is never mistaken for the hold.
 */
async function blackLead(file) {
  const { stderr } = await run(FFMPEG, [
    '-hide_banner', '-i', file,
    '-vf', 'blackdetect=d=0.05:pix_th=0.05',
    '-an', '-f', 'null', '-',
  ]).catch((e) => e);
  const m = /black_start:0(?:\.0+)?\s+black_end:([\d.]+)/.exec(stderr ?? '');
  return m ? Number(m[1]) : 0;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  let cuts;
  try {
    cuts = [
      { tag: 'en', file: await recordCut(browser, false, 'EN') },
      { tag: 'ar', file: await recordCut(browser, true, 'AR') },
    ];
  } finally {
    await browser.close();
  }

  const vf = 'scale=1080:1920:flags=lanczos,fps=30,format=yuv420p';
  for (const cut of cuts) {
    const ss = await blackLead(cut.file);
    cut.out = path.join(OUT, `_${cut.tag}.mp4`);
    console.log(`  ${cut.tag.toUpperCase()} trim ${ss}s`);
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', cut.file, '-ss', String(ss), '-t', String(CUT_SECONDS),
      '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      cut.out,
    ]);
  }

  const list = path.join(OUT, '_concat.txt');
  writeFileSync(list, cuts.map((c) => `file '${path.basename(c.out)}'`).join('\n'));
  const final = path.join(OUT, 'post1-reel-bilingual.mp4');
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-c', 'copy', '-movflags', '+faststart', final,
  ]);

  for (const c of cuts) rmSync(c.out, { force: true });
  rmSync(list, { force: true });
  console.log(`\ndone -> ${final} (${CUT_SECONDS * 2}s, 1080x1920)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
