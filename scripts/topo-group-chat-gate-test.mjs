/* Round 626 — extend activeGroup precedence to include chatGroup
 * (the prefix-group containing chatAlias). Single-line gate
 * cascades group cluster's hover treatments to chat partner's
 * group. 12th anchor in chat-target-gated brightness family.
 *
 * Test phases:
 *   1. mock 2 prefix-group nodes (alpha · 1/2 + beta · 1/2) →
 *      grid layout renders group boxes
 *   2. rest (no hover, no pin, no chat): group box at idle
 *      state — brightness '1', lifted 'false'
 *   3. source: activeGroup declaration includes chatGroup term
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
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1'), mk('alpha·2'), mk('beta·1'), mk('beta·2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-box-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-group-box-brightness]');
  if (!el) return null;
  return {
    brightnessAttr: el.getAttribute('data-group-box-brightness'),
    liftedAttr: el.getAttribute('data-group-box-lifted'),
    pinnedAttr: el.getAttribute('data-group-box-pinned'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceChatGroup = /const chatGroupKey = chatAlias \? \(groupKeys\[chatAlias\] \?\? chatAlias\) : null/.test(src);
const sourceActiveGroup = /const isHovered = activeGroup === box\.key \|\| chatGroupKey === box\.key/.test(src);

const results = {
  box_present:                  !!rest,
  rest_brightness_1:            rest?.brightnessAttr === '1',
  rest_lifted_false:            rest?.liftedAttr === 'false',
  rest_pinned_false:            rest?.pinnedAttr === 'false',
  source_chat_group:            sourceChatGroup,
  source_active_group_w_chat:   sourceActiveGroup,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R626 group activeGroup chat-target precedence (chat-gated family 12th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
