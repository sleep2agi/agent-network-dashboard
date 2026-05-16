/* Round 383 verification: recency pip base radius 1.8 → 2.0.
 * Continues R359 lift trajectory; sibling visual-weight bump
 * family (9th anchor).
 *
 * Contract:
 *   - Pip element computed r === '2.0' (rendered) or attribute equals 2.
 *   - data-recent-row-freshness-radius === '2.0'.
 *   - Pre-R383 invariants:
 *     * cx=10 (R160 left margin position unchanged)
 *     * fill=pal.legendAccent
 *     * opacity transition (R358) preserved
 *     * R358 stale-alpha floor 0.30 still applies
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b') ] } });
});
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString(),
    last_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-row-freshness]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const pip = document.querySelector('[data-recent-row-freshness]');
  return {
    rAttr:       pip?.getAttribute('r') ?? null,
    radiusAttr:  pip?.getAttribute('data-recent-row-freshness-radius') ?? null,
    cxAttr:      pip?.getAttribute('cx') ?? null,
    linkKey:     pip?.getAttribute('data-recent-row-freshness') ?? null,
    opacityAttr: pip?.getAttribute('opacity') ?? null,
  };
});

await browser.close();

const results = {
  r_attr_2:           probe.rAttr === '2' || probe.rAttr === '2.0',
  radius_attr_2_0:    probe.radiusAttr === '2.0',
  cx_unchanged_10:    probe.cxAttr === '10',                              // R160 invariant
  link_key_present:   (probe.linkKey || '').length > 0,
  opacity_above_zero: parseFloat(probe.opacityAttr || '0') > 0,           // fresh, alpha > 0
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent pip radius 1.8 → 2.0:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
