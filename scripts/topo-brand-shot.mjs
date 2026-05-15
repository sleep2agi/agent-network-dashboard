/* Screenshot TopoGraph with brand=intern flag (书小生 avatars). */
import { chromium } from 'playwright';

const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });

function makeFakeSession(index) {
  return {
    alias: `agent${index}号`,
    status: index % 5 === 0 ? 'working' : 'idle',
    network_id: 'default',
    created_at: '2026-05-13T00:00:00Z',
    updated_at: '2026-05-13T00:00:00Z',
    last_seen_at: '2026-05-13T00:00:00Z',
  };
}

for (const [variant, themes] of [['normal', ['cyber', 'light']], ['large', ['cyber']]]) {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
    await ctx.addInitScript(t => {
      try {
        localStorage.setItem('anet-theme', t);
        localStorage.setItem('anet-brand', 'intern');
        sessionStorage.setItem('anet_v3_auth', '1');
      } catch {}
    }, theme);

    if (variant === 'large') {
      await ctx.route('**/api/hub/status*', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const real = body.sessions || [];
        const padded = [...real];
        while (padded.length < 25) padded.push(makeFakeSession(padded.length));
        await route.fulfill({ response, json: { ...body, sessions: padded } });
      });
    }

    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:3000/?brand=intern', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
      const minNodes = window.location.search.includes('large') ? 14 : 8;
      return !!svg && svg.querySelectorAll('image[href*="intern_avatar"]').length > 0;
    }, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find(h => /Command mesh/i.test(h.textContent || ''));
      heading?.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `/tmp/anet-issue-50/topo-brand-${variant}-${theme}.png`, fullPage: false, animations: 'disabled', timeout: 30000 });
    await ctx.close();
  }
}
await browser.close();
console.log('done');
