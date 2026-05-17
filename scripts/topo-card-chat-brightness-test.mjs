/* Round 618 — extend label card hover treatments (stroke +
 * filter brightness) gate from hover-only to (hover || chat-
 * target). 4th anchor in chat-target-gated brightness family.
 *
 * Test phases:
 *   1. mock 2 idle nodes → label cards render
 *   2. rest (no hover, no chat): rest filter (shallow DS, NO
 *      brightness), brightness-attr='1', elevation='idle',
 *      chat-target='false'
 *   3. computed transition-property contains 'filter'
 *   4. source: stroke + filter conditionals include BOTH hover
 *      AND chat gates joined by `||`
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
await page.waitForSelector('[data-node-label-card-chat-target]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-label-card-chat-target]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-node-label-card-brightness'),
    elevationAttr: el.getAttribute('data-node-label-card-elevation'),
    chatTargetAttr: el.getAttribute('data-node-label-card-chat-target'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterOr = /filter: !reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\)\s*\?\s*\(isLight/.test(src);
const sourceStrokeOr = /stroke=\{!reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\)/.test(src);
const sourceAttrOr = /data-node-label-card-brightness=\{!reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\) \? '1\.15' : '1'\}/.test(src);
const sourceChatAttr = /data-node-label-card-chat-target=\{chatAlias === session\.alias \? 'true' : 'false'\}/.test(src);

const results = {
  card_present:           !!rest,
  rest_has_drop_shadow:   /drop-shadow/.test(rest?.filter || ''),
  rest_no_brightness:     !/brightness/.test(rest?.filter || ''),
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_elevation_idle:    rest?.elevationAttr === 'idle',
  rest_chat_target_false: rest?.chatTargetAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter_or:       sourceFilterOr,
  source_stroke_or:       sourceStrokeOr,
  source_attr_or:         sourceAttrOr,
  source_chat_attr:       sourceChatAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R618 card chat-target brightness (chat-gated family 4th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
