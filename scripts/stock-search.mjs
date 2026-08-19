// Stock photo search, for the marketing agent to shortlist with.
//
// Returns a COMPACT record per candidate — id, title, ratio, photographer,
// preview URL. Compact on purpose: an agent reading forty full JSON records
// burns its context on noise, and those are the only fields that decide a
// shortlist.
//
// It never downloads or licenses anything. That spends money or creates a
// licence obligation, and both are Jey's call.
//
// ── SOURCES ──────────────────────────────────────────────────────────────────
// pexels (default) — free key, issued instantly at pexels.com/api, no approval.
//   Right for OBJECT AND HANDS shots, which is what the Abniyah ads use. Free
//   stock does not verify model releases, so it is NOT right for a paid ad
//   containing an identifiable face.
//
// adobe — needs the Stock API entitlement, which is an ENTERPRISE agreement.
//   A self-service Stock subscription (including the trial) does NOT include
//   it: the Developer Console answers "License required". Kept here because
//   the moment that entitlement exists this works, and because Adobe is where
//   you go for anything with a face, since they supply releases and
//   indemnification.
//
// Setup — one of:
//   PEXELS_API_KEY=...          (.env.local)
//   ADOBE_STOCK_API_KEY=...     (.env.local)
//
// Usage:
//   node scripts/stock-search.mjs "receipts drawer" --vertical --limit 12
//   node scripts/stock-search.mjs "empty meeting chairs" --source adobe
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const words = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(limit|source)$/)).join(' ');
const has = (f) => args.includes(`--${f}`);
const val = (f, d) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

if (!words) {
  console.error('usage: node scripts/stock-search.mjs "<words>" [--vertical] [--limit N] [--source pexels|adobe]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const source = val('source', 'pexels');
const limit = val('limit', '12');
const vertical = has('vertical');

async function pexels() {
  const key = env.PEXELS_API_KEY;
  if (!key) throw new Error('Missing PEXELS_API_KEY in .env.local — get one free at pexels.com/api');
  const p = new URLSearchParams({ query: words, per_page: limit });
  if (vertical) p.set('orientation', 'portrait');
  const res = await fetch(`https://api.pexels.com/v1/search?${p}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b = await res.json();
  return {
    found: b.total_results,
    results: (b.photos ?? []).map((f) => ({
      id: f.id,
      title: f.alt || '(untitled)',
      ratio: (f.width / f.height).toFixed(2),
      by: f.photographer,
      page: f.url,
      preview: f.src?.large,
      download: f.src?.original,
      // free stock verifies no releases — say so rather than imply safety
      release: 'not verified by source',
    })),
  };
}

async function adobe() {
  const key = env.ADOBE_STOCK_API_KEY;
  if (!key) throw new Error('Missing ADOBE_STOCK_API_KEY in .env.local');
  const p = new URLSearchParams();
  p.set('search_parameters[words]', words);
  p.set('search_parameters[limit]', limit);
  p.set('search_parameters[filters][content_type:photo]', '1');
  if (vertical) p.set('search_parameters[orientation]', 'vertical');
  for (const c of ['id', 'title', 'thumbnail_500_url', 'has_releases', 'width', 'height', 'creator_name']) {
    p.append('result_columns[]', c);
  }
  const res = await fetch(`https://stock.adobe.io/Rest/Media/1/Search/Files?${p}`, {
    headers: { 'x-api-key': key, 'X-Product': 'Abniyah/1.0' },
  });
  if (res.status === 403 || res.status === 401) {
    throw new Error('Adobe rejected the key. The Stock API needs an ENTERPRISE entitlement; a self-service subscription does not include it. Use --source pexels.');
  }
  if (!res.ok) throw new Error(`Adobe Stock ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b = await res.json();
  return {
    found: b.nb_results,
    results: (b.files ?? []).map((f) => ({
      id: f.id,
      title: f.title,
      ratio: f.width && f.height ? (f.width / f.height).toFixed(2) : null,
      by: f.creator_name,
      preview: f.thumbnail_500_url,
      release: f.has_releases ?? null,
    })),
  };
}

try {
  const out = await (source === 'adobe' ? adobe() : pexels());
  console.log(JSON.stringify({ source, query: words, ...out }, null, 2));
  if (source === 'pexels') {
    console.error('\nNote: free stock does not verify model releases. Object and hands shots only for paid ads; anything with an identifiable face needs Adobe Stock or your own shoot with a signed release.');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
