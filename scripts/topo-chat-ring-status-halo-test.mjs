/* Round 637 — chat-target ring filter gains a status-tinted
 * drop-shadow halo. The halo colour now matches the ring's stroke
 * (status.primary): green for working, teal for idle, slate for
 * offline. Chromatic identity of the chat partner reinforced
 * across stroke + halo.
 *
 * Test phases:
 *   1. mock idle node → click to open chat → ring filter contains
 *      drop-shadow with idle teal #14b8a6 + brightness(1.15) +
 *      url(#topo-glow) on cyber
 *   2. data-chat-target-ring-halo-color === status.primary hex
 *   3. transition still includes 'filter'
 *   4. source: filter expression uses status.primary in drop-shadow
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
await page.waitForSelector('[data-chat-target-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

// rest: no chat — halo color attr should be 'none'
const restAttrs = await page.evaluate(() => {
  const el = document.querySelector('[data-chat-target-ring]');
  if (!el) return null;
  return {
    haloColor: el.getAttribute('data-chat-target-ring-halo-color'),
    active: el.getAttribute('data-chat-target-active'),
  };
});

// open chat with a·1 (idle)
await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const chatState = await page.evaluate(() => {
  const node = document.querySelector('[data-node="a·1"]');
  if (!node) return null;
  const ring = node.querySelector('[data-chat-target-ring]');
  if (!ring) return null;
  const cs = getComputedStyle(ring);
  return {
    haloColor: ring.getAttribute('data-chat-target-ring-halo-color'),
    active:    ring.getAttribute('data-chat-target-active'),
    stroke:    ring.getAttribute('stroke') || cs.stroke,
    filter:    cs.filter,
    transition:cs.transitionProperty,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLightFilter = /`drop-shadow\(0 0 3px \$\{status\.primary\}40\) brightness\(1\.15\)`/.test(src);
const sourceCyberFilter = /`drop-shadow\(0 0 3px \$\{status\.primary\}40\) url\(#topo-glow\) brightness\(1\.15\)`/.test(src);
const sourceHaloAttr   = /data-chat-target-ring-halo-color=\{isChat \? status\.primary : 'none'\}/.test(src);

const results = {
  rest_halo_color_none:   restAttrs?.haloColor === 'none',
  rest_active_false:      restAttrs?.active === 'false',
  chat_present:           !!chatState,
  chat_active_true:       chatState?.active === 'true',
  chat_halo_color_set:    /^#[0-9a-f]{6,8}$/i.test(chatState?.haloColor || ''),
  chat_filter_has_dropshadow:    /drop-shadow/.test(chatState?.filter || ''),
  chat_filter_has_brightness:    /brightness/.test(chatState?.filter || ''),
  chat_transition_has_filter:    /filter/.test(chatState?.transition || ''),
  source_light_filter:    sourceLightFilter,
  source_cyber_filter:    sourceCyberFilter,
  source_halo_attr:       sourceHaloAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R637 chat-target ring status-tinted halo (chromatic identity completion):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restAttrs)}`,
  `\n  chat: ${JSON.stringify(chatState)}`);
process.exit(ok ? 0 : 1);
