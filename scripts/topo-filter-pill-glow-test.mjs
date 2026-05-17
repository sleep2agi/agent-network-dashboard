/* Round 543 verification: status filter pill gains always-on tier-color
 * drop-shadow when rendered (pin-gated visual). Sibling to R477 legend
 * pin-ring pin-gated drop-shadow at the chip-row scope.
 *
 * Test phases:
 *   1. unpinned: no [data-active-filter="status"] element (pill hidden)
 *   2. click working pressure-bar segment to pin → pill renders
 *   3. pill has filter='drop-shadow(...)' with cyber working tier
 *      color rgba(134, 239, 172, ...) [#86efac]
 *   4. source-side regex confirms filter wired with tier-color ternary
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
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('a·3', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-pressure-seg="working"]', { timeout: 15000 });
await page.waitForTimeout(500);

// Phase 1: unpinned — verify pill absent
const unpinned = await page.evaluate(() => {
  return document.querySelector('[data-active-filter="status"]') !== null;
});

// Phase 2: click working pressure-seg to pin status='working'
await page.click('[data-pressure-seg="working"]');
await page.waitForTimeout(400);

// Phase 3: pill should now exist
await page.waitForSelector('[data-active-filter="status"]', { timeout: 5000 });
const pinned = await page.evaluate(() => {
  const el = document.querySelector('[data-active-filter="status"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    inlineFilter: el.style.filter,
    filter: cs.filter,
  };
});

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterWired =
  /filter: `drop-shadow\(0 0 3px \$\{[\s\S]*?pinnedStatus === 'working'[\s\S]*?'#047857'[\s\S]*?'#86efac'[\s\S]*?\}99\)`,/.test(src);

const results = {
  unpinned_pill_absent:   unpinned === false,
  pinned_pill_present:    pinned !== null,
  pinned_inline_filter:   /drop-shadow/.test(pinned?.inlineFilter || ''),
  pinned_computed_filter: /drop-shadow/.test(pinned?.filter || ''),
  // Cyber working text color #86efac → rgb(134, 239, 172); +0x99 alpha → rgba(134, 239, 172, 0.6)
  pinned_working_color:   /rgba?\(134,?\s*239,?\s*172/.test(pinned?.filter || ''),
  source_filter_wired:    sourceFilterWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R543 status filter pill glow:`,
  JSON.stringify(results, null, 2),
  '\n  unpinned absent:', unpinned,
  '\n  pinned:', JSON.stringify(pinned));
process.exit(ok ? 0 : 1);
