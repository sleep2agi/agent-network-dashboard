/* Round 484 verification: recent-row timestamp opacity lifts to
 * 1.0 when isRowHovered || isRowPinned, overriding the R191
 * freshness-decay tsAlpha. Inspection state shows full freshness
 * regardless of decay.
 *
 * Contract:
 *   - stale row (5min ago): tsAlpha ≈ 0.30, ts-lifted='false',
 *     live opacity matches tsAlpha
 *   - click stale row to pin: ts-lifted='true', live opacity='1'
 *   - source-file conditional wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const sessionFresh = new Date(Date.now() - 60 * 1000).toISOString();
const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

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
    mk('a·1', 'working'), mk('a·2', 'idle'),
  ] } });
});
// One stale message — its freshness alpha decays to ~0.30 at 5min
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: {
  messages: [
    { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 'old', created_at: fiveMinAgo },
  ],
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-row-ts]', { timeout: 15000 });
await page.waitForTimeout(500);

const readTs = () => page.evaluate(() => {
  const t = document.querySelector('[data-recent-row-ts]');
  if (!t) return null;
  return {
    alpha:  parseFloat(t.getAttribute('data-recent-row-ts-alpha') || '0'),
    lifted: t.getAttribute('data-recent-row-ts-lifted'),
    opacity: t.getAttribute('opacity'),
  };
});

const rest = await readTs();
// Click recent-row to pin
await page.click('[data-recent-row]');
await page.waitForTimeout(400);
const pinned = await readTs();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLiftConditional = /opacity=\{\(isRowHovered \|\| isRowPinned\) \? 1 : tsAlpha\}/.test(src);
const sourceLiftedAttr      = /data-recent-row-ts-lifted=/.test(src);

await browser.close();

// Rest: alpha < 0.7 (stale) + lifted='false' + opacity matches alpha
const restValid = rest?.lifted === 'false' && rest?.alpha < 0.7 &&
                  Math.abs(parseFloat(rest?.opacity || '0') - rest?.alpha) < 0.01;
// Pinned: lifted='true' + opacity=1 (overrides stale alpha)
const pinValid = pinned?.lifted === 'true' && pinned?.opacity === '1';

const results = {
  ts_present:          !!rest,
  rest_lifted_false:   rest?.lifted === 'false',
  rest_alpha_stale:    rest?.alpha < 0.7,
  rest_opacity_matches_alpha: restValid,
  pin_lifted_true:     pinned?.lifted === 'true',
  pin_opacity_is_1:    pinned?.opacity === '1',
  source_lift_conditional: sourceLiftConditional,
  source_lifted_attr:  sourceLiftedAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row ts opacity lift on active:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned:', JSON.stringify(pinned));
process.exit(ok ? 0 : 1);
