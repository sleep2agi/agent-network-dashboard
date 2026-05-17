/* Round 625 — extend isRowActive gate to include chat-target
 * endpoint match. Recent-row tint rect (R611) brightens when
 * row's from/to matches chatAlias. 11th anchor in chat-target-
 * gated brightness family.
 *
 * Test phases:
 *   1. mock 1 flow message → recent-row + tint rect render
 *   2. rest (no hover, no chat): tint rect at rest, no
 *      brightness, fill 'transparent'
 *   3. source: isRowActive declaration includes
 *      isChatEndpointRow term
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-row-tint-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-row-tint-brightness]');
  if (!el) return null;
  return {
    brightnessAttr: el.getAttribute('data-recent-row-tint-brightness'),
    fill: el.getAttribute('fill'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceChatEndpoint = /const isChatEndpointRow = !!chatAlias && \(link\.from === chatAlias \|\| link\.to === chatAlias\)/.test(src);
const sourceRowActive = /const isRowActive\s+= isRowHovered \|\| isRowPinned \|\| isChatEndpointRow/.test(src);

const results = {
  tint_present:                !!rest,
  rest_brightness_1:           rest?.brightnessAttr === '1',
  rest_fill_transparent:       rest?.fill === 'transparent',
  source_chat_endpoint:        sourceChatEndpoint,
  source_row_active_with_chat: sourceRowActive,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R625 recent-row chat-endpoint gate (chat-gated family 11th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
