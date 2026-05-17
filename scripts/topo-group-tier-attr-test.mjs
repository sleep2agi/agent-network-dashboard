/* Round 468 verification: each group <g> carries `data-group-tier`
 * classifier ('all-working' / 'all-idle' / 'all-offline' / 'mixed').
 * Surfaces the semantic the R319 pip-strip implicitly encodes
 * (single-tier groups render `name · count` only) as a queryable
 * DOM attr.
 *
 * Contract:
 *   - fixture mixes 2 working + 1 idle in alpha cluster → 'mixed'
 *   - fixture has 3 idle in beta cluster → 'all-idle'
 *   - source-file conditional wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
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
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    // alpha: 2 working + 1 idle → 'mixed'
    mk('alpha·1', 'working'),
    mk('alpha·2', 'working'),
    mk('alpha·3', 'idle'),
    // beta: 3 idle → 'all-idle'
    mk('beta·1',  'idle'),
    mk('beta·2',  'idle'),
    mk('beta·3',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-group][data-group-tier]', { timeout: 15000 });
await page.waitForTimeout(400);

const groups = await page.evaluate(() =>
  [...document.querySelectorAll('[data-group][data-group-tier]')].map(g => ({
    key:  g.getAttribute('data-group'),
    tier: g.getAttribute('data-group-tier'),
  }))
);

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceClassifier  = /groupTier =/.test(src) && /'all-working' :/.test(src) && /'mixed'/.test(src);
const sourceAttr        = /data-group-tier=\{groupTier\}/.test(src);

await browser.close();

const alpha = groups.find(g => g.key === 'alpha·');
const beta  = groups.find(g => g.key === 'beta·');
const tierIsValid = (t) => ['all-working', 'all-idle', 'all-offline', 'mixed'].includes(t);

const results = {
  groups_count_ge_2:      groups.length >= 2,
  alpha_is_mixed:         alpha?.tier === 'mixed',
  beta_is_all_idle:       beta?.tier === 'all-idle',
  all_tiers_valid:        groups.every(g => tierIsValid(g.tier)),
  source_classifier_wired: sourceClassifier,
  source_attr_wired:      sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-tier classifier attr:`, JSON.stringify(results),
  '\n  groups:', JSON.stringify(groups));
process.exit(ok ? 0 : 1);
