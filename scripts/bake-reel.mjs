// Bake the campaign photos into the teaser reel, producing ONE self-contained
// HTML file that can be uploaded anywhere and shows the real thing.
//
// WHY THIS EXISTS. In the working reel you load photos from disk through a
// picker, which keeps them off every server — but it also means they never
// travel. Open the page anywhere else and you get the drawn placeholders. For
// a team review, or for a Cloudflare Pages upload, the images have to be IN
// the file.
//
// Input:  assets/marketing/originals/web/{1-receipt,2-spending,3-meeting}.jpg
//         (web/ holds the resized copies — the multi-megabyte originals would
//          inflate ~33% as base64 and blow past any sane page weight)
// Output: assets/marketing/reel-final/index.html   ← GITIGNORED, holds
//         licensed imagery and must never be committed
//
// Usage: node scripts/bake-reel.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const SRC = 'assets/marketing/reel/index.html';
const PHOTOS = ['1-receipt', '2-spending', '3-meeting'];
const OUT_DIR = 'assets/marketing/reel-final';

if (!existsSync(SRC)) { console.error(`Missing ${SRC}`); process.exit(1); }
let html = readFileSync(SRC, 'utf8');

const dataUris = PHOTOS.map((name) => {
  const p = `assets/marketing/originals/web/${name}.jpg`;
  if (!existsSync(p)) {
    console.error(`Missing ${p}. Resize the originals into web/ first (see README).`);
    process.exit(1);
  }
  const b64 = readFileSync(p).toString('base64');
  console.log(`  ${name.padEnd(12)} ${Math.round(b64.length / 1024)} KB as base64`);
  return `data:image/jpeg;base64,${b64}`;
});

// Fill each bed in order and mark it, so the photo layer shows instead of the
// drawn placeholder.
let i = 0;
html = html.replace(/<img class="pic" alt="" \/>/g, () => `<img class="pic" alt="" src="${dataUris[i++]}" />`);
if (i !== 3) { console.error(`Expected 3 photo slots, filled ${i}. Did the reel markup change?`); process.exit(1); }
html = html.replace(/class="bed (b[123])"/g, 'class="bed $1 has-photo"');

// Drop the picker: in a shared copy it is noise at best, and "Clear" would
// throw away the very images that make the file worth sharing.
html = html.replace(/\n *<!-- One picker per beat[\s\S]*?<\/div>\n(?=\s*<\/div>)/, '\n');
html = html.replace(
  /<p>\s*<b>About the backgrounds\.<\/b>[\s\S]*?<\/p>/,
  '<p><b>About the backgrounds.</b> Licensed stock, embedded in this file, so it is self-contained: no network, no picker, nothing to load. Judge the type against them, particularly the middle third of each frame where the headline sits.</p>',
);

mkdirSync(OUT_DIR, { recursive: true });
const dest = `${OUT_DIR}/index.html`;
writeFileSync(dest, html);
console.log(`\n${dest} — ${Math.round(Buffer.byteLength(html) / 1024)} KB, self-contained.`);
console.log('Upload the reel-final FOLDER to Cloudflare Pages (it needs to find index.html at the root).');
