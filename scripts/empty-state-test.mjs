import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });

async function shoot(name, { emptyStats }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme','cyber'); sessionStorage.setItem('anet_v3_auth','1'); } catch {} });
  // force 0 sessions
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch(); const b = await r.json();
    await route.fulfill({ response: r, json: { ...b, sessions: [] } });
  });
  if (emptyStats) {
    // also zero out task history → true first-run
    await ctx.route('**/api/hub/stats*', async (route) => {
      const r = await route.fetch(); const b = await r.json();
      await route.fulfill({ response: r, json: { ...b, tasks: { by_status: [] } } });
    });
    await ctx.route('**/api/hub/tasks*', async (route) => {
      const r = await route.fetch(); const b = await r.json();
      await route.fulfill({ response: r, json: { ...b, tasks: [] } });
    });
  }
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  // find the empty-state card text
  const txt = await page.evaluate(() => {
    const h3 = [...document.querySelectorAll('h3')].map(h => h.textContent?.trim());
    return h3.filter(t => /agent/i.test(t || ''));
  });
  console.log(name, '→ empty-state headline(s):', JSON.stringify(txt));
  await page.screenshot({ path: `/tmp/anet-issue-50/empty-${name}.png`, fullPage: true });
  await ctx.close();
}

await shoot('with-history', { emptyStats: false });   // 0 sessions, real task history → "No agents online"
await shoot('true-firstrun', { emptyStats: true });   // 0 sessions, 0 tasks → "Spin up your first agent"
await browser.close();
console.log('done');
