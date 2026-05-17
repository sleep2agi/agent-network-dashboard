/* Round 642 — chat-target ring gains a SECOND drop-shadow layer
 * at 6px blur + 20% alpha, layered with R637's 3px+40% halo. The
 * chat partner now radiates a "near + far" layered glow vocabulary.
 *
 * Test phases:
 *   1. rest: no chat, halo-layers='0', filter='none'
 *   2. click a·1 → halo-layers='2', filter contains TWO drop-shadow
 *      substrings with the same status.primary tint at different
 *      blur radii (3px + 6px) and different alpha (~40% + ~20%)
 *   3. source: both light + cyber filter expressions stack the
 *      two drop-shadows ahead of url(#topo-glow) + brightness
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
await page.waitForSelector('[data-chat-target-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-chat-target-ring]');
  if (!el) return null;
  return {
    layers: el.getAttribute('data-chat-target-ring-halo-layers'),
    active: el.getAttribute('data-chat-target-active'),
  };
});

await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const active = await page.evaluate(() => {
  const node = document.querySelector('[data-node="a·1"]');
  if (!node) return null;
  const ring = node.querySelector('[data-chat-target-ring]');
  if (!ring) return null;
  const cs = getComputedStyle(ring);
  return {
    layers: ring.getAttribute('data-chat-target-ring-halo-layers'),
    active: ring.getAttribute('data-chat-target-active'),
    haloColor: ring.getAttribute('data-chat-target-ring-halo-color'),
    filter: cs.filter,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLightFilter = /`drop-shadow\(0 0 3px \$\{status\.primary\}40\) drop-shadow\(0 0 6px \$\{status\.primary\}20\) brightness\(1\.15\)`/.test(src);
const sourceCyberFilter = /`drop-shadow\(0 0 3px \$\{status\.primary\}40\) drop-shadow\(0 0 6px \$\{status\.primary\}20\) url\(#topo-glow\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr  = /data-chat-target-ring-halo-layers=\{isChat \? '2' : '0'\}/.test(src);

const dropShadowMatches = (active?.filter || '').match(/drop-shadow/g) || [];

const results = {
  rest_layers_0:          rest?.layers === '0',
  rest_active_false:      rest?.active === 'false',
  active_layers_2:        active?.layers === '2',
  active_active_true:     active?.active === 'true',
  active_halo_color:      /^#[0-9a-f]{6,8}$/i.test(active?.haloColor || ''),
  active_two_dropshadows: dropShadowMatches.length === 2,
  active_has_brightness:  /brightness/.test(active?.filter || ''),
  active_has_glow_filter: /url\("#topo-glow"\)/.test(active?.filter || ''),
  source_light_filter:    sourceLightFilter,
  source_cyber_filter:    sourceCyberFilter,
  source_layers_attr:     sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R642 chat-target ring multi-layer halo (near + far):`,
  JSON.stringify(results, null, 2),
  `\n  rest:   ${JSON.stringify(rest)}`,
  `\n  active: ${JSON.stringify(active)}`);
process.exit(ok ? 0 : 1);
