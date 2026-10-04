// Phone sweep: open every route at iPhone size, screenshot it, and flag what a
// phone user would trip on. Run it before any native build and after any
// layout change — it is how the Oct 2026 "squeezed rows / cut-off money"
// report would have been caught before it reached a real iPhone.
//
//   node scripts/phone-sweep.mjs                      # local dev server, admin
//   node scripts/phone-sweep.mjs https://app.abniyah.com resident
//   node scripts/phone-sweep.mjs http://localhost:5173 admin /finance,/projects
//
// Flags, per route:
//   PAGE SCROLLS SIDEWAYS  the document is wider than the screen
//   wide:                  an element pokes past the right edge and nothing
//                          above it clips or scrolls (tables inside a scroll
//                          container are fine and not reported)
//   truncated:             text actually cut with an ellipsis (money must
//                          never appear here — see FitText)
//   small taps:            buttons/links under 32px in either dimension
//
// Credentials come from scripts/rls-personas.json (git-ignored; copy the
// .example). "admin" uses the persona labelled "building admin", "resident"
// the one labelled "resident". Screenshots land in sweep/<who>/.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const WHO = process.argv[3] ?? 'admin';
const ONLY = process.argv[4]?.split(',');
const OUT = `sweep/${WHO}`;
mkdirSync(OUT, { recursive: true });

const personas = JSON.parse(readFileSync('scripts/rls-personas.json', 'utf8'));
const want = WHO === 'resident' ? /resident/i : /building admin/i;
const acc = personas.find((p) => want.test(p.label));
if (!acc) { console.error(`no persona labelled like ${want} in scripts/rls-personas.json`); process.exit(1); }

const ROUTES = {
  admin: ['/dashboard', '/finance', '/reports', '/dues', '/projects', '/amenities', '/contracts', '/inspections', '/issues', '/meetings', '/voting', '/lost-found', '/contacts', '/structure', '/users', '/buildings', '/licenses', '/settings'],
  resident: ['/dashboard', '/finance', '/reports', '/issues', '/meetings', '/voting', '/lost-found', '/contacts', '/projects', '/amenities', '/settings'],
}[WHO];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
await ctx.addInitScript(() => { try { localStorage.setItem('abniyah_beta_ok', '1'); localStorage.setItem('abniyah_beta_scope', 'full'); localStorage.setItem('i18nextLng', 'en'); } catch {} });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.locator('input[type="email"]').fill(acc.email);
await page.locator('input[type="password"]').fill(acc.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL('**/dashboard', { timeout: 30000 });
await page.waitForTimeout(2500);

const audit = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = { overflowX: document.documentElement.scrollWidth > vw, wide: [], truncated: [], smallTaps: [] };
  const clipped = (e) => {
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') return true;
    }
    return false;
  };
  const label = (el) => (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 32);
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (r.right > vw + 1 && cs.position !== 'fixed' && !clipped(el)) out.wide.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')} right=${Math.round(r.right)} "${label(el)}"`);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.truncated.push(`"${label(el)}"`);
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && (r.width < 32 || r.height < 32) && el.closest('main')) out.smallTaps.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${label(el)}"`);
  }
  out.wide = out.wide.slice(0, 6);
  out.truncated = out.truncated.slice(0, 8);
  out.smallTaps = [...new Set(out.smallTaps)].slice(0, 10);
  return out;
});

let problems = 0;
for (const route of ONLY ?? ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const name = route.replace(/[/?=]/g, '_').replace(/^_/, '') || 'root';
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const a = await audit();
  const flags = [
    a.overflowX ? 'PAGE SCROLLS SIDEWAYS' : null,
    a.wide.length ? `wide: ${a.wide.join(' | ')}` : null,
    a.truncated.length ? `truncated: ${a.truncated.join(', ')}` : null,
    a.smallTaps.length ? `small taps: ${a.smallTaps.join(', ')}` : null,
  ].filter(Boolean);
  if (a.overflowX || a.wide.length || a.truncated.length) problems++;
  console.log(`${route}  ${flags.length ? '\n   ' + flags.join('\n   ') : 'clean'}`);
}
await browser.close();
console.log(problems ? `\n${problems} route(s) with layout problems` : '\nall routes clean');
process.exit(problems ? 1 : 0);
