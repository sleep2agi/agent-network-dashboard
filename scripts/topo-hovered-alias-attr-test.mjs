/* Round 488 verification: root svg surfaces `data-topo-hovered-alias`
 * identity attr — pairs with R466 any-hover boolean. Extends the
 * R469/R471/R487 root-svg state surface set to 11 attrs.
 *
 * Contract:
 *   - default (no hover): data-topo-hovered-alias=''
 *   - after hover on node g[data-node]: attr === alias
 *   - source-file wiring confirmed
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
    mk('alpha·a1', 'working'),
    mk('alpha·a2', 'idle'),
    mk('beta·b1',  'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('svg[data-topo-hovered-alias]', { timeout: 15000 });
await page.waitForTimeout(1500);

// Phase 1: default (no hover) — attr present and empty
const restAttr = await page.evaluate(() =>
  document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-hovered-alias')
);

// Phase 2: hover on first node, attr === alias
//
// onMouseEnter at g[data-node] is unreliable with page.mouse alone
// (R486 banked: overlays intercept). Dispatch React-synthetic-friendly
// pointerenter+mouseenter+mouseover on the inner circle element where
// the actual React handler is bound.
const firstAlias = await page.evaluate(() => {
  const g = document.querySelector('g[data-node]');
  if (!g) return null;
  const alias = g.getAttribute('data-node');
  // Find a child element that bubbles to the React listener. The hover
  // handler is bound on the wrapping <g> via React; firing on any
  // descendant with bubbles:true reaches it.
  const target = g.querySelector('circle, image, rect') || g;
  ['pointerenter', 'pointerover', 'mouseenter', 'mouseover'].forEach((type) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
  });
  return alias;
});
await page.waitForTimeout(400);
const hoverAttr = await page.evaluate(() =>
  document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-hovered-alias')
);

// Phase 3: dispatch matching leave events — attr returns to empty
await page.evaluate(() => {
  const g = document.querySelector('g[data-node]');
  if (!g) return;
  const target = g.querySelector('circle, image, rect') || g;
  ['pointerleave', 'pointerout', 'mouseleave', 'mouseout'].forEach((type) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
  });
});
await page.mouse.move(50, 50);
await page.waitForTimeout(400);
const afterAttr = await page.evaluate(() =>
  document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-hovered-alias')
);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceAttr = /data-topo-hovered-alias=\{hoveredAlias \?\? ''\}/.test(src);

const results = {
  rest_attr_present:   restAttr !== null,
  rest_attr_empty:     restAttr === '',
  hover_node_resolved: !!firstAlias,
  hover_attr_matches:  hoverAttr === firstAlias,
  release_attr_empty:  afterAttr === '',
  source_attr_wired:   sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} svg data-topo-hovered-alias attr:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(restAttr), '/ alias:', firstAlias, '/ hover:', JSON.stringify(hoverAttr),
  '/ after-release:', JSON.stringify(afterAttr));
process.exit(ok ? 0 : 1);
