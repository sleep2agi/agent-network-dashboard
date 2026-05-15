/* Round 40 verification: hovering a node brightens edges touching it
 * and dims the rest. Three edges in the fleet — hover one node and
 * compare base-path opacity of touching vs non-touching edges. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

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
  const sessions = ['alpha', 'beta', 'gamma', 'delta'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
// Edges:
//   alpha → beta  (touches alpha + beta)
//   alpha → gamma (touches alpha + gamma)
//   delta → gamma (touches delta + gamma — does NOT touch alpha)
const now = new Date().toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { from_alias: 'alpha', to_alias: 'beta',  content: 'm', created_at: now },
  { from_alias: 'alpha', to_alias: 'gamma', content: 'm', created_at: now },
  { from_alias: 'delta', to_alias: 'gamma', content: 'm', created_at: now },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(600);

const edgeOpacities = () => page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  // Each flow-link <g> has two paths; the FIRST one is the base path
  // (carries the <title> with route) — read its opacity.
  return [...svg.querySelectorAll(':scope > g > g')]
    .map(g => {
      const base = g.querySelector('path');
      const title = base?.querySelector('title');
      if (!title) return null;
      return { route: title.textContent.split('\n')[0], opacity: +base.getAttribute('opacity') };
    })
    .filter(Boolean);
});

const before = await edgeOpacities();
// Hover alpha → its two outgoing edges should brighten, delta→gamma should dim.
await page.locator('g[data-node="alpha"]').hover();
await page.waitForTimeout(350);
const after = await edgeOpacities();

await browser.close();
const get = (rows, r) => rows.find(e => e.route === r)?.opacity ?? null;
const b_ab = get(before, 'alpha → beta');
const b_ag = get(before, 'alpha → gamma');
const b_dg = get(before, 'delta → gamma');
const a_ab = get(after,  'alpha → beta');
const a_ag = get(after,  'alpha → gamma');
const a_dg = get(after,  'delta → gamma');

const results = {
  baselineMatches: b_ab !== null && b_ag !== null && b_dg !== null && Math.abs(b_ab - b_dg) < 0.001,
  hoverBrightensAlphaBeta: a_ab !== null && a_ab > b_ab + 0.05,
  hoverBrightensAlphaGamma: a_ag !== null && a_ag > b_ag + 0.05,
  hoverDimsDeltaGamma: a_dg !== null && a_dg < b_dg - 0.05,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge hover:`, JSON.stringify(results),
  `\n  before α→β=${b_ab} α→γ=${b_ag} δ→γ=${b_dg}`,
  `\n  after  α→β=${a_ab} α→γ=${a_ag} δ→γ=${a_dg}`);
process.exit(ok ? 0 : 1);
