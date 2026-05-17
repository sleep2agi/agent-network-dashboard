/* Round 478 verification: recent-row freshness pip gains filter:
 * drop-shadow glow when alpha > 0.7 (just-fired flow within ~30s).
 * Freshness-gated (not pin/hover-gated), so the glow reads as
 * "this signal is live" — natural breathing feel that tracks
 * actual data freshness.
 *
 * Contract:
 *   - fresh (created_at = now): alpha=1.0, data-recent-row-freshness-
 *     glow='true', computed filter starts with 'drop-shadow'
 *   - stale (created_at = 5min ago): alpha→0.30, glow='false',
 *     filter === 'none'
 *   - source-file conditional wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const nowIso = () => new Date().toISOString();
const sessionFresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: sessionFresh, updated_at: sessionFresh, last_seen_at: sessionFresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('b·1', 'working'),
  ] } });
});
// Mix fresh + stale messages so we get rows in both freshness tiers.
// Fresh: created NOW → alpha = 1.0 (within 30s gate)
// Stale: created 5min ago → alpha = 0.30 (R10 stale floor)
const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: {
  messages: [
    { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 'live',  created_at: nowIso() },
    { id: 'm2', from_alias: 'b·1', to_alias: 'a·1', content: 'stale', created_at: fiveMinAgo },
  ],
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-row-freshness]', { timeout: 15000 });
await page.waitForTimeout(800);

const probe = await page.evaluate(() => {
  const pips = [...document.querySelectorAll('[data-recent-row-freshness]')];
  return pips.map(p => {
    const cs = getComputedStyle(p);
    return {
      key:    p.getAttribute('data-recent-row-freshness'),
      alpha:  parseFloat(p.getAttribute('data-recent-row-freshness-alpha') || '0'),
      glow:   p.getAttribute('data-recent-row-freshness-glow'),
      filter: cs.filter,
    };
  });
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGlowAttr  = /data-recent-row-freshness-glow=\{alpha > 0\.7/.test(src);
const sourceDropShadow = /drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\)/.test(src);
const sourceFilterTween = /filter 200ms ease-out/.test(src);

await browser.close();

const fresh = probe.find(p => p.alpha > 0.7);
const stale = probe.find(p => p.alpha < 0.5);

const results = {
  pips_count_ge_2:        probe.length >= 2,
  fresh_pip_found:        !!fresh,
  fresh_glow_true:        fresh?.glow === 'true',
  fresh_filter_has_drop:  fresh && /drop-shadow/.test(fresh.filter),
  stale_pip_found:        !!stale,
  stale_glow_false:       stale?.glow === 'false',
  stale_filter_none:      stale?.filter === 'none',
  source_glow_attr:       sourceGlowAttr,
  source_drop_shadow:     sourceDropShadow,
  source_filter_tween:    sourceFilterTween,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row freshness pip drop-shadow:`, JSON.stringify(results),
  '\n  fresh pip:', JSON.stringify(fresh),
  '\n  stale pip:', JSON.stringify(stale));
process.exit(ok ? 0 : 1);
