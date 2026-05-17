/* 🎯 Round 615 — 100th consecutive visible-polish round milestone.
 * Chat-target ring stacks brightness(1.15) onto url(#topo-glow)
 * on isChat=true. Introduces a NEW 4th brightness gate type:
 * chat-target-gated.
 *
 * Test phases:
 *   1. mock 2 idle nodes → chat ring renders (opacity 0 at rest)
 *   2. rest (no chat target): filter='none', brightness-attr='1',
 *      active='false'
 *   3. computed transition-property contains 'filter'
 *   4. source: stacked filter conditional + data-attr
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
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    opacity: cs.opacity,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-node-chat-ring-brightness'),
    activeAttr: el.getAttribute('data-chat-target-active'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: isChat\s*\?\s*\(isLight\s*\?\s*'brightness\(1\.15\)'\s*:\s*'url\(#topo-glow\) brightness\(1\.15\)'\)\s*:\s*undefined/.test(src);
const sourceAttr = /data-node-chat-ring-brightness=\{isChat \? '1\.15' : '1'\}/.test(src);

const results = {
  ring_present:           !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_opacity_zero:      parseFloat(rest?.opacity || '1') === 0,
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_active_false:      rest?.activeAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} 🎯 R615 chat-target ring brightness (NEW chat-target-gated brightness, 100 rounds milestone):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
