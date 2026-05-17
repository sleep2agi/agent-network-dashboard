/* Round 480 verification: edge badge circle gains filter: drop-
 * shadow glow on isHot (link.count >= 10). 5th anchor in the
 * R476/R477/R478/R479 drop-shadow family — first traffic-volume-
 * gated variant.
 *
 * Contract:
 *   - cold edge (count < 10): data-edge-badge-glow='false' AND
 *     computed filter === 'none'
 *   - hot edge (count >= 10): glow='true' AND computed filter
 *     starts with 'drop-shadow' using hotStroke @ 0x80 alpha
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
// Build messages: 12 from a·1 → a·2 (HOT, count=12 >= 10)
//                  2 from b·1 → a·1 (cold, count=2 < 10)
const hotMessages = [];
for (let i = 0; i < 12; i++) {
  hotMessages.push({
    id: `hot-${i}`, from_alias: 'a·1', to_alias: 'a·2',
    content: `m${i}`, created_at: nowIso(),
  });
}
const coldMessages = [
  { id: 'c1', from_alias: 'b·1', to_alias: 'a·1', content: 'c1', created_at: nowIso() },
  { id: 'c2', from_alias: 'b·1', to_alias: 'a·1', content: 'c2', created_at: nowIso() },
];
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: {
  messages: [...hotMessages, ...coldMessages],
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-badge-glow]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const badges = [...document.querySelectorAll('[data-edge-badge-glow]')];
  return badges.map(b => {
    const cs = getComputedStyle(b);
    return {
      glow:   b.getAttribute('data-edge-badge-glow'),
      filter: cs.filter,
    };
  });
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGlowAttr   = /data-edge-badge-glow=\{isHot/.test(src);
const sourceDropShadow = /drop-shadow\(0 0 3px \$\{hotStroke\}80\)/.test(src);
const sourceFilterTween = /filter 200ms ease-out/.test(src);

await browser.close();

const hot = probe.find(b => b.glow === 'true');
const cold = probe.find(b => b.glow === 'false');

const results = {
  badges_count_ge_2:        probe.length >= 2,
  hot_badge_found:          !!hot,
  hot_filter_has_drop:      hot && /drop-shadow/.test(hot.filter),
  cold_badge_found:         !!cold,
  cold_filter_none:         cold?.filter === 'none',
  source_glow_attr:         sourceGlowAttr,
  source_drop_shadow:       sourceDropShadow,
  source_filter_tween:      sourceFilterTween,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge badge hot-lane drop-shadow:`, JSON.stringify(results),
  '\n  hot badge:', JSON.stringify(hot),
  '\n  cold badge:', JSON.stringify(cold));
process.exit(ok ? 0 : 1);
