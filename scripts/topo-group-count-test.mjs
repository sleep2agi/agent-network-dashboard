/* Round 19 verification: each group-box label carries a member-count
 * tspan ("· N"), reflecting the actual member count of the group. */
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
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  // A站 with 4 members, B站 with 2 members → 2 group boxes (counts 4 and 2).
  const aliases = ['A站红', 'A站蓝', 'A站绿', 'A站黄', 'B站乙', 'B站丙'];
  const sessions = aliases.map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('g[data-group]').length === 2;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);

const labels = await page.$$eval('svg[viewBox="0 0 1000 680"] g[data-group]', els => els.map(g => {
  const text = g.querySelector('text');
  const tspan = text.querySelector('tspan');
  return {
    key: g.getAttribute('data-group'),
    full: text.textContent.replace(/\s+/g, ' ').trim(),
    chipFontSize: tspan ? +tspan.getAttribute('font-size') : null,
    chipFontWeight: tspan ? tspan.getAttribute('font-weight') : null,
  };
}));

await browser.close();
const a = labels.find(l => l.key === 'A站');
const b = labels.find(l => l.key === 'B站');
const results = {
  bothGroupsHaveChip: a?.full === 'A站· 4' && b?.full === 'B站· 2',
  chipSmallerFont: a?.chipFontSize === 11,
  chipLighterWeight: a?.chipFontWeight === '400',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group count chip:`, JSON.stringify(results), 'labels=', labels);
process.exit(ok ? 0 : 1);
