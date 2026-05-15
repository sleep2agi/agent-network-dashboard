/* Round 16 verification: three flow-link arrow markers exist with the
 * right sizes, all using userSpaceOnUse so they're decoupled from stroke. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.removeItem('anet-brand');
    localStorage.removeItem('anet-topo-view');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['a', 'b', 'c'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z',
    last_seen_at: new Date().toISOString(),
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('g[data-node]').length === 3;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);

const m = await page.evaluate(() => {
  const reads = (id) => {
    const el = document.querySelector(`marker#${id}`);
    if (!el) return null;
    return {
      width: +el.getAttribute('markerWidth'),
      units: el.getAttribute('markerUnits'),
    };
  };
  return { s: reads('topo-arrow-s'), m: reads('topo-arrow'), l: reads('topo-arrow-l') };
});

await browser.close();
const results = {
  smallExists: m.s?.width === 12 && m.s?.units === 'userSpaceOnUse',
  mediumExists: m.m?.width === 16 && m.m?.units === 'userSpaceOnUse',
  largeExists: m.l?.width === 22 && m.l?.units === 'userSpaceOnUse',
  legendCompatible: m.m !== null, // legend uses url(#topo-arrow); medium tier must exist by that id
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} arrow tiers:`, JSON.stringify(results), 'sizes:', m);
process.exit(ok ? 0 : 1);
