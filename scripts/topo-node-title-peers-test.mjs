/* Round 147 verification: node tooltip extends R98's flow summary
 * with the actual sender / receiver alias breakdown. The R97 idiom
 * — anywhere the UI shows "N" should hover-explain WHICH N — was
 * applied to filter pills, group labels, vendor letters, pressure
 * segments, recent-row, active-links chip. The node title was the
 * last surface showing only aggregate counts ("12 in / 5 out");
 * R147 adds peer lines.
 *
 * Fleet:
 *   alpha — sends 3 msgs to beta, 5 to gamma, 2 to delta
 *   beta  — sends 4 msgs to alpha, 1 to gamma
 *   gamma — quiet (receiver only)
 *   delta — quiet (receiver only)
 *
 * For alpha:
 *   flowOut = 3 + 5 + 2 = 10
 *   flowIn  = 4 (from beta)
 *   senders ← beta (4)
 *   receivers → beta (3), gamma (5), delta (2) — sorted by count desc:
 *               gamma (5), beta (3), delta (2)
 *
 * Title should contain:
 *   "flows: 4 in / 10 out"
 *   "← from: beta (4)"
 *   "→ to:   gamma (5), beta (3), delta (2)"  (sorted desc by count)
 *
 * Also verify a node with no flows (gamma will have 5 inbound from alpha
 * and 1 from beta; let's pick delta which only has 2 inbound from alpha).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
    mk('alpha', 'working'), mk('beta', 'working'),
    mk('gamma', 'idle'),    mk('delta', 'idle'),
  ] } });
});

const now = Date.now();
const mkMsg = (id, from, to, ageMs) => ({
  id, from_alias: from, to_alias: to, content: 'hi',
  network_id: 'default', created_at: new Date(now - ageMs).toISOString(),
});
const msgs = [];
let id = 0;
// alpha → beta (3), gamma (5), delta (2)
for (let i = 0; i < 3; i++) msgs.push(mkMsg(`m${id++}`, 'alpha', 'beta',  10000 + id * 100));
for (let i = 0; i < 5; i++) msgs.push(mkMsg(`m${id++}`, 'alpha', 'gamma', 10000 + id * 100));
for (let i = 0; i < 2; i++) msgs.push(mkMsg(`m${id++}`, 'alpha', 'delta', 10000 + id * 100));
// beta → alpha (4), gamma (1)
for (let i = 0; i < 4; i++) msgs.push(mkMsg(`m${id++}`, 'beta',  'alpha', 10000 + id * 100));
for (let i = 0; i < 1; i++) msgs.push(mkMsg(`m${id++}`, 'beta',  'gamma', 10000 + id * 100));
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const readTitle = (alias) => page.evaluate((a) => {
  const node = document.querySelector(`g[data-node="${a}"]`);
  return node?.querySelector('title')?.textContent || '';
}, alias);

const alphaTitle = await readTitle('alpha');
const deltaTitle = await readTitle('delta');

await browser.close();

const results = {
  // alpha: flows aggregate
  alpha_flowSummary:  alphaTitle.includes('flows: 4 in / 10 out'),
  // alpha: senders line
  alpha_sendersLine:  alphaTitle.includes('← from: beta (4)'),
  // alpha: receivers line — must be sorted desc by count (gamma 5, beta 3, delta 2)
  alpha_receiversOrder: alphaTitle.includes('→ to:   gamma (5), beta (3), delta (2)'),

  // delta: receiver only, only inbound from alpha (2 msgs)
  delta_flowSummary:  deltaTitle.includes('flows: 2 in / 0 out'),
  delta_sendersLine:  deltaTitle.includes('← from: alpha (2)'),
  delta_noReceivers:  !deltaTitle.includes('→ to:'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node title peers:`, JSON.stringify(results),
  `\n  alpha title:\n${alphaTitle}`,
  `\n  delta title:\n${deltaTitle}`);
process.exit(ok ? 0 : 1);
