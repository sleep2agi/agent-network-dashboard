/* Round 126 verification: hot-edge accent on the midpoint count
 * badge. The edge stroke width (line 2344 of TopoGraph.tsx) scales
 * with count but clamps at 7px — so count=5 and count=50 look
 * identical at the line. R100 introduced the badge for high-traffic
 * lanes, but the badge itself stayed the same colour regardless.
 *
 * R126 buckets count ≥ 10 as "hot" and flips the badge stroke to
 * amber (#d97706 light, #fbbf24 dark) + thickens to width 2. Pin
 * still wins (uses legendHeadline) so pinned-hot reads as locked
 * via the badge text + edge brightness, not via a third stroke
 * colour. Reuses R125's amber convention — "amber draws the eye".
 *
 * Fleet:
 *   alpha (working) — pings beta with 12 msgs (hot)
 *   beta  (working) — pings gamma with 4 msgs (warm, badge but not hot)
 *   gamma (idle)
 *
 * Path:
 *   1. alpha→beta:  badge hot=true, stroke matches amber rgb
 *   2. beta→gamma:  badge hot=false, stroke matches flowEdge (not amber)
 *   3. Click alpha→beta to pin; pin still wins (stroke = legendHeadline,
 *      data-edge-count-badge-pinned=true, hot=true is still flagged
 *      via the attribute but the visible stroke is the pin colour)
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
    mk('alpha', 'working'),
    mk('beta',  'working'),
    mk('gamma', 'idle'),
  ] } });
});

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'x', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
// 12 alpha→beta = HOT, 4 beta→gamma = warm
const msgs = [];
for (let i = 0; i < 12; i++) msgs.push(mkMsg(`a${i}`, 'alpha', 'beta',  20000 + i * 500));
for (let i = 0; i < 4;  i++) msgs.push(mkMsg(`b${i}`, 'beta',  'gamma', 30000 + i * 500));
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-edge-count-badge="alpha->beta"]', { timeout: 10000 });
await page.waitForTimeout(400);

const inspect = (key) => page.evaluate((k) => {
  const g = document.querySelector(`[data-edge-count-badge="${k}"]`);
  if (!g) return null;
  const circle = g.querySelector('circle');
  return {
    hot:    g.getAttribute('data-edge-count-badge-hot'),
    pinned: g.getAttribute('data-edge-count-badge-pinned'),
    stroke:      circle?.getAttribute('stroke'),
    strokeWidth: circle?.getAttribute('stroke-width'),
  };
}, key);

// State 1 + 2: before any pin
const a2b = await inspect('alpha->beta');
const b2g = await inspect('beta->gamma');

// State 3: pin alpha→beta — pin wins over hot
await page.locator('[data-edge-count-badge="alpha->beta"]').click();
await page.waitForTimeout(200);
const a2bPinned = await inspect('alpha->beta');

await browser.close();

// Cyber theme amber: #fbbf24
const amberHex = '#fbbf24';
const flowEdgeNotAmber = (s) => !!s && s.toLowerCase() !== amberHex.toLowerCase();

const results = {
  hot_present:        a2b !== null && a2b.hot === 'true',
  hot_strokeAmber:    a2b !== null && (a2b.stroke || '').toLowerCase() === amberHex.toLowerCase(),
  hot_strokeWidth2:   a2b !== null && a2b.strokeWidth === '2',
  warm_notHot:        b2g !== null && b2g.hot === 'false',
  warm_strokeNotAmber: b2g !== null && flowEdgeNotAmber(b2g.stroke),
  warm_strokeWidth1:  b2g !== null && b2g.strokeWidth === '1',
  pin_winsOverHot:    a2bPinned !== null && a2bPinned.pinned === 'true' && a2bPinned.hot === 'true'
                      && (a2bPinned.stroke || '').toLowerCase() !== amberHex.toLowerCase()
                      && a2bPinned.strokeWidth === '2',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-badge hot:`, JSON.stringify(results),
  `\n  a2b(12msg)=`, a2b,
  `\n  b2g(4msg)=`, b2g,
  `\n  a2b-pinned=`, a2bPinned);
process.exit(ok ? 0 : 1);
