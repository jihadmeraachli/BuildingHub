// QA: the public demo funnel — abniyah.com button → /demo auto-login → read-only app.
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? '.';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// 1. Landing shows the demo button
await page.goto('https://abniyah.com', { waitUntil: 'networkidle', timeout: 45000 });
const demoBtn = page.locator('a[href="https://app.abniyah.com/demo"]').first();
console.log('landing demo button:', (await demoBtn.count()) > 0 ? 'present' : 'MISSING');

// 2. /demo auto-login lands on the dashboard
await page.goto('https://app.abniyah.com/demo', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForURL('**/dashboard', { timeout: 30000 });
await page.waitForTimeout(5000);
console.log('after /demo, url:', page.url());
const body = await page.textContent('body');
console.log('demo banner:', body.includes('live demo building') ? 'present' : 'MISSING');
console.log('fund figure:', body.includes('469') ? 'present ($469)' : 'MISSING');
console.log('units=20:', body.includes('20') ? 'present' : 'MISSING');
await page.screenshot({ path: `${outDir}/demo-dashboard.png` });

// 3. Finance is visible but read-only
await page.goto('https://app.abniyah.com/finance', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(4000);
const fin = await page.textContent('body');
console.log('finance data:', fin.includes('13,470') || fin.includes('13470') ? 'present' : 'MISSING');
console.log('Record Payment button:', fin.includes('Record Payment') ? 'VISIBLE (BAD)' : 'hidden (good)');
await page.screenshot({ path: `${outDir}/demo-finance.png` });

// 4. Admin pages must bounce or show nothing
await page.goto('https://app.abniyah.com/users', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3000);
console.log('after /users, url:', page.url());
await page.goto('https://app.abniyah.com/settings', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3000);
console.log('after /settings, url:', page.url(), page.url().includes('dashboard') ? '(redirected, good)' : '(CHECK)');

// 5. Sidebar has no config section for the demo viewer
await page.goto('https://app.abniyah.com/dashboard', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3000);
const side = await page.textContent('body');
console.log('People tab:', side.includes('People') ? 'VISIBLE (CHECK)' : 'hidden (good)');
console.log('Import tab:', side.includes('Import') ? 'VISIBLE (CHECK)' : 'hidden (good)');

await browser.close();
console.log('done');
