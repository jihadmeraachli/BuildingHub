// Marketing screenshots for abniyah.com — retina captures from the live app.
import { chromium } from 'playwright';

const [outDir, email, password] = process.argv.slice(2);
const browser = await chromium.launch();

async function capture(lang, shots) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript((l) => {
    localStorage.setItem('i18nextLng', l);
    localStorage.setItem('abniyah_beta_ok', '1');
    sessionStorage.setItem('abniyah_gs_routed', '1'); // marketing shots want the real pages
  }, lang);
  const page = await ctx.newPage();
  await page.goto('https://app.abniyah.com', { waitUntil: 'networkidle', timeout: 45000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(7000);
  for (const [name, path] of shots) {
    await page.goto(`https://app.abniyah.com${path}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log(`shot: ${name}`);
  }
  await ctx.close();
}

await capture('en', [
  ['shot-dashboard-en', '/dashboard'],
  ['shot-finance-en', '/finance'],
  ['shot-setup-en', '/getting-started'],
]);
await capture('ar', [
  ['shot-dashboard-ar', '/dashboard'],
]);

await browser.close();
console.log('done');
