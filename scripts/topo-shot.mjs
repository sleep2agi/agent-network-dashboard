import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });
for (const theme of ['cyber', 'light']) {
  for (const v of [{ tag: 'desktop', width: 1440, height: 900 }, { tag: 'mobile', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
    await ctx.addInitScript(t => { try { localStorage.setItem('anet-theme', t); sessionStorage.setItem('anet_v3_auth','1'); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
    // dev mode hydrates slowly; wait for SWR to fetch sessions
    await page.waitForFunction(() => {
      const h2 = [...document.querySelectorAll('h2')].find(h => /Command mesh/i.test(h.textContent || ''));
      if (!h2) return false;
      const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
      return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
    }, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find(h => /Command mesh/i.test(h.textContent || ''));
      heading?.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `/tmp/anet-issue-50/topo-${theme}-${v.tag}.png`, fullPage: false, animations: 'disabled', timeout: 30000 });
    await ctx.close();
  }
}
await browser.close();
console.log('done');
