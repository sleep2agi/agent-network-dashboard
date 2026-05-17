/* Round 616 — alias text brightness gate extends from hover-only
 * to (hover || chat-target). 2nd anchor in chat-target-gated
 * brightness family (sibling to R615 chat ring).
 *
 * Test phases:
 *   1. mock 2 idle nodes → alias text renders
 *   2. rest (no hover, no chat): filter='none', brightness-attr='1'
 *   3. computed transition-property contains 'filter'
 *   4. source: filter conditional includes BOTH hover AND chat
 *      gates, joined by `||`
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
await page.waitForSelector('[data-node-alias-text]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-alias-text]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-node-alias-brightness'),
    hoveredAttr: el.getAttribute('data-node-alias-hovered'),
    chatTargetAttr: el.getAttribute('data-node-alias-chat-target'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: !reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\)\s*\?\s*`drop-shadow\(0 0 2px \$\{status\.text\}80\) brightness\(1\.15\)`\s*:\s*undefined/.test(src);
const sourceAttr = /data-node-alias-brightness=\{!reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\) \? '1\.15' : '1'\}/.test(src);

const results = {
  alias_present:          !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  rest_chat_target_false: rest?.chatTargetAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter_or_gate:  sourceFilter,
  source_attr_or_gate:    sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R616 alias chat-target brightness (chat-gated family 2/N):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
