/* Round 656 — runtime badge filter gains a SECOND outer drop-shadow
 * at 4px + 0x4c alpha (half R559 inner 0x99). 15th anchor in multi-
 * layer halo family (1st per-node-badge anchor).
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
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-runtime-badge-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restBadges = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-runtime-badge-halo-layers]')).map(el => ({
    layers: el.getAttribute('data-runtime-badge-halo-layers'),
    glow:   el.getAttribute('data-runtime-badge-glow'),
  }));
});

// Open chat to fire isNodeActive (chat-gated per R620)
await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const activeState = await page.evaluate(() => {
  const node = document.querySelector('[data-node="a·1"]');
  if (!node) return null;
  const badge = node.querySelector('[data-runtime-badge-halo-layers]');
  if (!badge) return null;
  const cs = getComputedStyle(badge);
  return {
    layers: badge.getAttribute('data-runtime-badge-halo-layers'),
    glow:   badge.getAttribute('data-runtime-badge-glow'),
    filter: cs.filter,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /`drop-shadow\(0 0 2px \$\{rt\.color\}99\) drop-shadow\(0 0 4px \$\{rt\.color\}4c\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr = /data-runtime-badge-halo-layers=\{isNodeActive \? '2' : '0'\}/.test(src);

const dropShadowCount = (activeState?.filter?.match(/drop-shadow/g) || []).length;
const restAllZero = restBadges.every(b => b.layers === '0' && b.glow === 'false');

const results = {
  badges_present:           restBadges.length >= 2,
  rest_all_zero:            restAllZero,
  active_present:           !!activeState,
  active_layers_2:          activeState?.layers === '2',
  active_glow_true:         activeState?.glow === 'true',
  active_two_dropshadows:   dropShadowCount === 2,
  source_filter:            sourceFilter,
  source_layers_attr:       sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R656 runtime badge multi-layer halo (1st per-node-badge anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest:   ${JSON.stringify(restBadges)}`,
  `\n  active: ${JSON.stringify(activeState)}`);
process.exit(ok ? 0 : 1);
