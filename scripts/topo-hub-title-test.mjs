/* Round 43 verification: central hub carries a `<title>` summary in ring
 * layout. Assertions:
 *   - hub renders in ring layout (data-topo-hub group present)
 *   - <title> reads "Network hub · N sessions · …" with the right counts
 *   - zero-count clauses (online/working/links) drop cleanly
 *   - grid layout doesn't render the hub at all */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe({ layout, sessionsSpec, msgs = [] }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((lay) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', lay);
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, layout);
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = sessionsSpec.map(s => ({
      alias: s.alias, status: s.status, network_id: nid, project_dir: null,
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
    const hub = document.querySelector('g[data-topo-hub]');
    const title = hub?.querySelector('title');
    return { hubPresent: !!hub, titleText: title?.textContent || null };
  });
  await ctx.close();
  return data;
}

// Ring + mixed-status fleet → full summary line
const ringFull = await probe({
  layout: 'ring',
  sessionsSpec: [
    { alias: 'a', status: 'working' },
    { alias: 'b', status: 'idle' },
    { alias: 'c', status: 'idle' },
    { alias: 'd', status: 'offline' },
  ],
  msgs: [
    { from_alias: 'a', to_alias: 'b', content: 'm', created_at: new Date().toISOString() },
  ],
});
// Ring + all-offline → online/working/links clauses drop
const ringOfflineOnly = await probe({
  layout: 'ring',
  sessionsSpec: [
    { alias: 'x', status: 'offline' },
    { alias: 'y', status: 'offline' },
  ],
});
// Grid → no hub at all
const grid = await probe({
  layout: 'grid',
  sessionsSpec: [{ alias: 'a', status: 'idle' }, { alias: 'b', status: 'idle' }],
});

await browser.close();
const results = {
  ringHubPresent:        ringFull.hubPresent === true,
  ringFullSummary:       ringFull.titleText === 'Network hub · 4 sessions · 3 online · 1 working · 1 active link',
  ringOfflineSummary:    ringOfflineOnly.hubPresent === true && ringOfflineOnly.titleText === 'Network hub · 2 sessions',
  gridHasNoHub:          grid.hubPresent === false,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub title:`, JSON.stringify(results),
  `\n  ringFull=${JSON.stringify(ringFull.titleText)}`,
  `\n  ringOffline=${JSON.stringify(ringOfflineOnly.titleText)}`,
  `\n  gridHub=${grid.hubPresent}`);
process.exit(ok ? 0 : 1);
