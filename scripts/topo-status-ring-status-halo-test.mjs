/* Round 638 — status ring filter gains a status-tinted drop-shadow
 * halo on isRingHovered. Sibling to R637 chat-target ring at the
 * innermost per-node identity surface (r=radius). Halo color
 * matches stroke color (status.primary) across all status tiers.
 *
 * Test phases:
 *   1. mock idle node + working node
 *   2. rest: no hover/chat → status-ring-halo-color='none' for all
 *   3. open chat with idle node a·1 (R621 extends isRingHovered to
 *      chat-target) → that ring's halo-color = idle teal hex,
 *      filter contains drop-shadow(teal); other node stays 'none'
 *   4. source: filter expression includes status.primary in drop-
 *      shadow across all 3 branches (light, cyber+online,
 *      cyber+offline)
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

// rest: collect all status-ring halo colors (should be 'none')
const restRings = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-node-status-ring]')).map(el => ({
    haloColor: el.getAttribute('data-node-status-ring-halo-color'),
    hovered:   el.getAttribute('data-node-status-ring-hovered'),
  }));
});

// open chat with a·1 (idle) — R621 extends isRingHovered to chat-target
await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const chatState = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('[data-node]')).map(g => {
    const ring = g.querySelector('[data-node-status-ring]');
    if (!ring) return null;
    const cs = getComputedStyle(ring);
    return {
      alias:     g.getAttribute('data-node'),
      haloColor: ring.getAttribute('data-node-status-ring-halo-color'),
      hovered:   ring.getAttribute('data-node-status-ring-hovered'),
      stroke:    cs.stroke,
      filter:    cs.filter,
    };
  }).filter(Boolean);
  return all;
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLightFilter   = /`drop-shadow\(0 0 2px \$\{status\.primary\}40\) brightness\(1\.15\)`/.test(src);
const sourceCyberOnline   = /`drop-shadow\(0 0 2px \$\{status\.primary\}40\) url\(#topo-glow\) brightness\(1\.15\)`/.test(src);
const sourceHaloAttr      = /data-node-status-ring-halo-color=\{isRingHovered \? status\.primary : 'none'\}/.test(src);

const restAllNone = restRings.every(r => r.haloColor === 'none');
const chatActiveRing = chatState.find(c => c.alias === 'a·1');
const chatIdleRing   = chatState.find(c => c.alias === 'a·2');

const results = {
  rest_all_halo_none:      restAllNone,
  chat_a1_present:         !!chatActiveRing,
  chat_a1_halo_color:      /^#[0-9a-f]{6,8}$/i.test(chatActiveRing?.haloColor || ''),
  chat_a1_hovered_true:    chatActiveRing?.hovered === 'true',
  chat_a1_filter_dropshadow:   /drop-shadow/.test(chatActiveRing?.filter || ''),
  chat_a1_filter_brightness:   /brightness/.test(chatActiveRing?.filter || ''),
  chat_a2_present:         !!chatIdleRing,
  chat_a2_halo_none:       chatIdleRing?.haloColor === 'none',
  source_light_filter:     sourceLightFilter,
  source_cyber_online:     sourceCyberOnline,
  source_halo_attr:        sourceHaloAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R638 status ring status-tinted halo (chromatic identity at innermost identity surface):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restRings)}`,
  `\n  chat: ${JSON.stringify(chatState)}`);
process.exit(ok ? 0 : 1);
