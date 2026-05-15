/* Round 45 verification: recent-signal panel shows "no flow yet" placeholder
 * when flowLinks is empty; renders normal link rows when populated. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe({ msgs }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'grid');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = ['a', 'b'].map(a => ({
      alias: a, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  const data = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    const empty = svg.querySelector('text[data-recent-signal-empty]');
    // count flow-link description rows in the recent-signal panel (translate(16,16))
    const panel = [...svg.querySelectorAll(':scope > g[transform^="translate(16, 16)"]')][0];
    const linkRows = panel ? [...panel.querySelectorAll('text')].filter(t => /->.*\/.*\//.test(t.textContent || '')).length : 0;
    return { emptyShown: !!empty, emptyText: empty?.textContent || null, linkRows };
  });
  await ctx.close();
  return data;
}

const noFlow = await probe({ msgs: [] });
const withFlow = await probe({ msgs: [
  { from_alias: 'a', to_alias: 'b', content: 'hello', created_at: new Date().toISOString() },
] });
await browser.close();

const results = {
  emptyShowsPlaceholder: noFlow.emptyShown === true && /no flow yet/i.test(noFlow.emptyText || ''),
  emptyHidesLinkRows: noFlow.linkRows === 0,
  populatedHidesPlaceholder: withFlow.emptyShown === false,
  populatedShowsLinkRows: withFlow.linkRows >= 1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-signal empty state:`, JSON.stringify(results),
  `\n  noFlow=`, noFlow, `\n  withFlow=`, withFlow);
process.exit(ok ? 0 : 1);
