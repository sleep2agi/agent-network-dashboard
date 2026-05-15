import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });
for (const theme of ['cyber', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(t => { try { localStorage.setItem('anet-theme', t); sessionStorage.setItem('anet_v3_auth','1'); localStorage.removeItem('anet-topo-view'); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(300);
  const sec = page.locator('section:has(h2:text("Command mesh"))');
  await sec.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await sec.screenshot({ path: `/tmp/anet-issue-50/topo-controls-${theme}.png` });
  await ctx.close();
}
await browser.close();
console.log('done');
