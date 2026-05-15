/* Round 117 verification: Cmd+K "Clear topology filters" also
 * releases pinnedEdgeKey (the 4th pin dim R116 added). Plus a new
 * granular "Clear topology edge pin" command. Mirrors R90's
 * vendor-clear treatment.
 *
 * Drive via direct CustomEvent dispatch (deterministic — same path
 * R82/R90/R108 tests use). Verify:
 *   - Pin status + edge → click "clear" → both release
 *   - Pin status + edge → click "clear-edge" → only edge releases
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
    sessionStorage.removeItem('anet-topo-pinned-vendor');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
    mk('gamma', 'idle'),
  ] } });
});

const now = Date.now();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - 30000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-recent-row]', { timeout: 10000 });
await page.waitForTimeout(400);

// Helper: pin status via R69 CustomEvent + pin edge via row click.
const setupBothPins = async () => {
  await page.evaluate(() => {
    sessionStorage.setItem('anet-topo-pinned-status', 'working');
    window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'working' } }));
  });
  await page.locator('[data-recent-row="alpha->beta"]').click();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(300);
};

const probe = () => page.evaluate(() => ({
  statusPill: document.querySelector('[data-active-filter="status"]') !== null,
  edgePinned: document.querySelector('[data-recent-row-pinned="true"]') !== null,
}));

// === Test 1: clear-all clears both. ===
await setupBothPins();
const bothBefore = await probe();
await page.evaluate(() => {
  sessionStorage.removeItem('anet-topo-pinned-status');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'clear' } }));
});
await page.waitForTimeout(300);
const afterClearAll = await probe();

// === Test 2: clear-edge clears only edge. ===
await setupBothPins();
const bothBefore2 = await probe();
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'clear-edge' } }));
});
await page.waitForTimeout(300);
const afterClearEdge = await probe();

await browser.close();

const results = {
  bothBefore_statusPinned: bothBefore.statusPill === true,
  bothBefore_edgePinned:   bothBefore.edgePinned === true,
  clearAll_statusGone:     afterClearAll.statusPill === false,
  clearAll_edgeGone:       afterClearAll.edgePinned === false,
  bothBefore2_setup:       bothBefore2.statusPill && bothBefore2.edgePinned,
  clearEdge_statusKept:    afterClearEdge.statusPill === true,
  clearEdge_edgeGone:      afterClearEdge.edgePinned === false,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} cmdk edge clear:`, JSON.stringify(results),
  `\n  bothBefore=`,      bothBefore,
  `\n  afterClearAll=`,   afterClearAll,
  `\n  afterClearEdge=`,  afterClearEdge);
process.exit(ok ? 0 : 1);
