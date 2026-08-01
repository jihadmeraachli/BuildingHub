// Verify the Getting Started checklist renders on the dashboard (test account).
import { chromium } from 'playwright';

const [outDir, email, password] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
await ctx.addInitScript(() => {
  localStorage.setItem('i18nextLng', 'en');
  localStorage.setItem('abniyah_beta_ok', '1');
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('https://app.abniyah.com', { waitUntil: 'networkidle', timeout: 45000 });
await page.locator('input[type="email"]').fill(email);
await page.locator('input[type="password"]').fill(password);
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(8000);
await page.screenshot({ path: `${outDir}/gs-dashboard.png` });
console.log('shot taken:', page.url());
await browser.close();
