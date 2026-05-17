/* Round 643 — status ring filter gains a SECOND drop-shadow layer
 * at 4px blur + 0x20 alpha, mirroring R642's multi-layer halo on
 * the chat-target ring. Per-node identity rings now share the same
 * "near + far" 2-layer halo vocabulary on hover/chat.
 *
 * Test phases:
 *   1. rest: no hover/chat, halo-layers='0'
 *   2. click a·1 → R621 extends isRingHovered to chat-target;
 *      that node's status ring gets halo-layers='2'; computed
 *      filter has exactly 2 drop-shadow substrings
 *   3. source: light + cyber+online + cyber+offline branches all
 *      stack 2 drop-shadows (2px + 4px blur)
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'idle'),
    mk('a·2', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-status-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restRings = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-node-status-ring]')).map(el => ({
    layers: el.getAttribute('data-node-status-ring-halo-layers'),
    hovered: el.getAttribute('data-node-status-ring-hovered'),
  }));
});

await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const chatState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-node]')).map(g => {
    const ring = g.querySelector('[data-node-status-ring]');
    if (!ring) return null;
    const cs = getComputedStyle(ring);
    return {
      alias:   g.getAttribute('data-node'),
      layers:  ring.getAttribute('data-node-status-ring-halo-layers'),
      hovered: ring.getAttribute('data-node-status-ring-hovered'),
      filter:  cs.filter,
    };
  }).filter(Boolean);
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLight = /`drop-shadow\(0 0 2px \$\{status\.primary\}40\) drop-shadow\(0 0 4px \$\{status\.primary\}20\) brightness\(1\.15\)`/.test(src);
const sourceCyberOnline = /`drop-shadow\(0 0 2px \$\{status\.primary\}40\) drop-shadow\(0 0 4px \$\{status\.primary\}20\) url\(#topo-glow\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr = /data-node-status-ring-halo-layers=\{isRingHovered \? '2' : '0'\}/.test(src);

const restAllZeroLayers = restRings.every(r => r.layers === '0');
const chatActiveRing = chatState.find(c => c.alias === 'a·1');
const chatIdleRing = chatState.find(c => c.alias === 'a·2');
const activeDropShadowCount = (chatActiveRing?.filter?.match(/drop-shadow/g) || []).length;

const results = {
  rest_rings_present:       restRings.length >= 2,
  rest_all_layers_0:        restAllZeroLayers,
  chat_a1_present:          !!chatActiveRing,
  chat_a1_layers_2:         chatActiveRing?.layers === '2',
  chat_a1_hovered:          chatActiveRing?.hovered === 'true',
  chat_a1_two_dropshadows:  activeDropShadowCount === 2,
  chat_a1_brightness:       /brightness/.test(chatActiveRing?.filter || ''),
  chat_a2_layers_0:         chatIdleRing?.layers === '0',
  source_light_filter:      sourceLight,
  source_cyber_online:      sourceCyberOnline,
  source_layers_attr:       sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R643 status ring multi-layer halo (innermost identity ring 2-layer halo):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restRings)}`,
  `\n  chat: ${JSON.stringify(chatState)}`);
process.exit(ok ? 0 : 1);
