// RTL QA sweep — screenshots public + in-app pages in Arabic. Temporary tool,
// not part of the app. Usage: node rtl-sweep.mjs <outDir> <email> <password>
import { chromium } from 'playwright';

const [outDir, email, password] = process.argv.slice(2);
const APP = 'https://app.abniyah.com';

const browser = await chromium.launch();

async function newCtx(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((l) => {
    localStorage.setItem('i18nextLng', l);
    localStorage.setItem('abniyah_beta_ok', '1');
  }, lang);
  return ctx;
}

async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage });
  const dir = await page.evaluate(() => document.documentElement.dir);
  console.log(`shot: ${name} (dir=${dir})`);
}

// ── Public pages ─────────────────────────────────────────────
for (const [name, url, lang, full] of [
  ['landing-ar', 'https://abniyah.com', 'ar', true],
  ['privacy-ar', 'https://abniyah.com/privacy', 'ar', true],
  ['terms-ar', 'https://abniyah.com/terms', 'ar', true],
]) {
  const ctx = await newCtx(lang);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await shot(page, name, full);
  await ctx.close();
}

// ── Register wizard (public, behind gate) ────────────────────
{
  const ctx = await newCtx('ar');
  const page = await ctx.newPage();
  await page.goto(`${APP}/register`, { waitUntil: 'networkidle', timeout: 45000 });
  await shot(page, 'register-role-ar');
  // pick the first role card → account step
  await page.locator('button:has(p)').first().click();
  await shot(page, 'register-account-ar');
  await ctx.close();
}

// ── In-app sweep with the test account ───────────────────────
{
  const ctx = await newCtx('ar');
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle', timeout: 45000 });
  await shot(page, 'login-ar');

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(5000);
  await shot(page, 'after-login-ar');

  const routes = ['dashboard', 'finance', 'dues', 'structure', 'issues', 'meetings', 'users', 'security', 'licenses', 'buildings', 'settings'];
  for (const r of routes) {
    try {
      await page.goto(`${APP}/${r}`, { waitUntil: 'networkidle', timeout: 45000 });
      await shot(page, `app-${r}-ar`);
    } catch (e) {
      console.log(`FAILED ${r}: ${e.message}`);
    }
  }
  await ctx.close();
}

await browser.close();
console.log('sweep complete');
