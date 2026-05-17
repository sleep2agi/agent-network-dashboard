/* Round 645 — node alias text gains a SECOND drop-shadow layer at
 * 4px blur + 0x40 alpha. Extends the chromatic-identity 2-layer
 * halo family from rings (R642/R643/R644) to TEXT — first text-
 * scope multi-layer halo anchor.
 *
 * Test phases:
 *   1. rest: alias text halo-layers='0', no filter
 *   2. click a·1 → chat-target gate fires → alias text halo-layers='2',
 *      computed filter has EXACTLY 2 drop-shadow substrings with
 *      status.text tint at different alphas
 *   3. source: filter expression stacks 2 drop-shadows
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

const restTexts = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-node-alias-text]')).map(el => ({
    layers: el.getAttribute('data-node-alias-halo-layers'),
    glow: el.getAttribute('data-node-alias-glow'),
    chatTarget: el.getAttribute('data-node-alias-chat-target'),
  }));
});

await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const chatState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-node-alias-text]')).map(el => {
    const cs = getComputedStyle(el);
    return {
      alias: el.getAttribute('data-node-alias-text'),
      layers: el.getAttribute('data-node-alias-halo-layers'),
      chatTarget: el.getAttribute('data-node-alias-chat-target'),
      filter: cs.filter,
    };
  });
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /`drop-shadow\(0 0 2px \$\{status\.text\}80\) drop-shadow\(0 0 4px \$\{status\.text\}40\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr = /data-node-alias-halo-layers=\{!reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\) \? '2' : '0'\}/.test(src);

const restAllZero = restTexts.every(t => t.layers === '0');
const chatActive = chatState.find(c => c.alias === 'a·1');
const chatActiveDropShadowCount = (chatActive?.filter?.match(/drop-shadow/g) || []).length;
const chatIdle = chatState.find(c => c.alias === 'a·2');

const results = {
  texts_present:           restTexts.length >= 2,
  rest_all_zero:           restAllZero,
  chat_a1_present:         !!chatActive,
  chat_a1_layers_2:        chatActive?.layers === '2',
  chat_a1_chat_target_true:chatActive?.chatTarget === 'true',
  chat_a1_two_dropshadows: chatActiveDropShadowCount === 2,
  chat_a1_brightness:      /brightness/.test(chatActive?.filter || ''),
  chat_a2_layers_0:        chatIdle?.layers === '0',
  source_filter:           sourceFilter,
  source_layers_attr:      sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R645 node alias text multi-layer halo (text-scope chromatic identity):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restTexts)}`,
  `\n  chat: ${JSON.stringify(chatState)}`);
process.exit(ok ? 0 : 1);
