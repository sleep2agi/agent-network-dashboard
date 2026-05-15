/* Force triple-tier rendering by injecting fake extra sessions via
 * playwright route(). Verifies the new code path at N≈25 without
 * needing a 25-node real network. */
import { chromium } from 'playwright';

const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });

function makeFakeSession(index) {
  const statuses = ['working', 'idle', 'idle', 'idle', 'idle'];
  return {
    alias: `agent${index}号`,
    status: statuses[index % statuses.length],
    network_id: 'default',
    created_at: '2026-05-13T00:00:00Z',
    updated_at: '2026-05-13T00:00:00Z',
    last_seen_at: '2026-05-13T00:00:00Z',
  };
}

for (const theme of ['cyber', 'light']) {
  for (const v of [{ tag: 'desktop', width: 1440, height: 900 }]) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
    await ctx.addInitScript(t => {
      try { localStorage.setItem('anet-theme', t); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
    }, theme);

    // Intercept the status endpoint (which carries `sessions`) and pad to ~25
    await ctx.route('**/api/hub/status*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const real = body.sessions || [];
      const padded = [...real];
      while (padded.length < 25) padded.push(makeFakeSession(padded.length));
      await route.fulfill({ response, json: { ...body, sessions: padded } });
    });

    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
      return !!svg && svg.querySelectorAll('circle[r="26"]').length >= 14;
    }, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find(h => /Command mesh/i.test(h.textContent || ''));
      heading?.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `/tmp/anet-issue-50/topo-large-${theme}-${v.tag}.png`, fullPage: false, animations: 'disabled', timeout: 30000 });
    await ctx.close();
  }
}
await browser.close();
console.log('done');
