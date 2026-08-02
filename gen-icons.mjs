// Regenerate every app icon from gen-icons.html (browser-rendered, so the
// gradient-through-mask is identical to Logo.tsx — no compositing math to get
// wrong). Usage: node gen-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
// CSS mask images are CORS-fetched, which file:// can't satisfy — inline the
// mask as a data URI so the page needs no subresources at all.
const maskB64 = readFileSync(join(root, 'public', 'logo-mask.png')).toString('base64');
const html = readFileSync(join(root, 'gen-icons.html'), 'utf8')
  .replaceAll('url(./public/logo-mask.png)', `url(data:image/png;base64,${maskB64})`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2800, height: 2800 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000); // let the mask decode

const OUT = [
  ['#icon1024', 'assets/icon.png'],
  ['#icon512',  'public/pwa-512.png'],
  ['#icon192',  'public/pwa-192.png'],
  ['#icon180',  'public/apple-touch-icon.png'],
  ['#splash',   'assets/splash.png'],
  ['#splash',   'assets/splash-dark.png'],
];
for (const [sel, out] of OUT) {
  await page.locator(sel).screenshot({ path: join(root, out) });
  console.log('wrote', out);
}
// Email header logo — transparent background (referenced by URL in emailHtml).
await page.locator('#emailLogo').screenshot({ path: join(root, 'public/email-logo.png'), omitBackground: true });
console.log('wrote public/email-logo.png');
await browser.close();
