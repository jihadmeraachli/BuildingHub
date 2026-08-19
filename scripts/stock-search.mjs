// Adobe Stock search, for the marketing agent to shortlist with.
//
// Search needs only an API key (no OAuth, no access token), so this is a thin
// wrapper that returns a COMPACT result — id, title, keywords, preview URL,
// and whether a model release is on file. Compact matters: an agent reading
// forty full JSON records burns its context on noise, and the only fields that
// decide a shortlist are these.
//
// It deliberately CANNOT license or download anything. Licensing spends money
// and is Jey's decision, so this stops at "here are the candidates".
//
// Setup, once:
//   1. developer.adobe.com/console → create a project → add the Adobe Stock API
//   2. Copy the API Key (Client ID)
//   3. Add to .env.local (gitignored):
//        ADOBE_STOCK_API_KEY=...
//
// Usage:
//   node scripts/stock-search.mjs "receipts drawer" --vertical --limit 12
//   node scripts/stock-search.mjs "empty meeting room chairs" --no-people
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const words = args.filter((a) => !a.startsWith('--')).join(' ');
const has = (f) => args.includes(`--${f}`);
const val = (f, d) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

if (!words) {
  console.error('usage: node scripts/stock-search.mjs "<search words>" [--vertical] [--no-people] [--limit N]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = env.ADOBE_STOCK_API_KEY;
if (!KEY) {
  console.error('Missing ADOBE_STOCK_API_KEY in .env.local — see the header of this file.');
  process.exit(1);
}

const p = new URLSearchParams();
p.set('search_parameters[words]', words);
p.set('search_parameters[limit]', val('limit', '12'));
p.set('search_parameters[filters][content_type:photo]', '1');
// Vertical by default for Stories and Reels; the reel crops to 9:16.
if (has('vertical')) p.set('search_parameters[orientation]', 'vertical');
if (has('no-people')) p.set('search_parameters[filters][has_releases]', 'false');
for (const c of ['id', 'title', 'keywords', 'thumbnail_500_url', 'has_releases', 'width', 'height', 'creator_name']) {
  p.append('result_columns[]', c);
}

const res = await fetch(`https://stock.adobe.io/Rest/Media/1/Search/Files?${p}`, {
  headers: { 'x-api-key': KEY, 'X-Product': 'Abniyah/1.0' },
});
if (!res.ok) {
  console.error(`Adobe Stock returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const body = await res.json();
const rows = (body.files ?? []).map((f) => ({
  id: f.id,
  title: f.title,
  release: f.has_releases ?? null,       // matters only when a face is identifiable
  ratio: f.width && f.height ? (f.width / f.height).toFixed(2) : null,
  preview: f.thumbnail_500_url,
  // top keywords only: the full list runs to 50 and says nothing extra
  keywords: (f.keywords ?? []).slice(0, 8).map((k) => k.name ?? k),
}));

console.log(JSON.stringify({ query: words, found: body.nb_results, results: rows }, null, 2));
