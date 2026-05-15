/* Round 50 verification: hovering a flow edge boosts that edge's own
 * opacity 2× and thickens its stroke 1.4×, while every other edge dims
 * to 0.35×. Complements R49 (which highlights the endpoint nodes) —
 * together they make "this is the edge you're pointing at" unmistakable.
 *
 * Sessions: alpha, beta, gamma, delta. Messages: alpha→beta + gamma→delta.
 * Hover the alpha→beta hitbox and read:
 *   - alpha→beta visible-path opacity boosts (~2× base)
 *   - alpha→beta visible-path strokeWidth = 1.4 × base (rounded by browser)
 *   - gamma→delta visible-path opacity dims (~0.35× base)
 *   - gamma→delta visible-path strokeWidth unchanged
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['alpha', 'beta', 'gamma', 'delta'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
const now = new Date().toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { from_alias: 'alpha', to_alias: 'beta',  content: 'm', created_at: now },
  { from_alias: 'gamma', to_alias: 'delta', content: 'm', created_at: now },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(600);

// Read each flow edge's visible base path (the one with marker-end).
const readEdges = () => page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const rows = [];
  for (const g of svg.querySelectorAll(':scope > g > g')) {
    const t = g.querySelector('path[data-edge-hitbox] title');
    if (!t) continue;
    const route = (t.textContent || '').split('\n')[0];
    const base = [...g.querySelectorAll(':scope > path')].find(
      p => !p.hasAttribute('data-edge-hitbox') && p.hasAttribute('marker-end')
    );
    if (!base) continue;
    rows.push({
      route,
      opacity: +base.getAttribute('opacity'),
      strokeWidth: +base.getAttribute('stroke-width'),
    });
  }
  return rows;
});

const before = await readEdges();

// Move cursor to a point ON the alpha→beta hitbox curve.
const target = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  for (const g of svg.querySelectorAll(':scope > g > g')) {
    const t = g.querySelector('path[data-edge-hitbox] title');
    if (t && /^alpha → beta/.test(t.textContent || '')) {
      const hb = g.querySelector('path[data-edge-hitbox]');
      const pt = hb.getPointAtLength(hb.getTotalLength() / 2);
      const ctm = hb.getScreenCTM();
      return { x: pt.x * ctm.a + pt.y * ctm.c + ctm.e, y: pt.x * ctm.b + pt.y * ctm.d + ctm.f };
    }
  }
  return null;
});
if (!target) { console.log('❌ no alpha→beta hitbox found'); process.exit(1); }
await page.mouse.move(10, 10);
await page.mouse.move(target.x, target.y);
await page.waitForTimeout(350);
const during = await readEdges();

await browser.close();

const find = (rows, r) => rows.find(e => e.route === r);
const b_ab = find(before, 'alpha → beta');
const b_gd = find(before, 'gamma → delta');
const a_ab = find(during, 'alpha → beta');
const a_gd = find(during, 'gamma → delta');

const results = {
  baselineMatches: b_ab && b_gd && Math.abs(b_ab.opacity - b_gd.opacity) < 0.001 && b_ab.strokeWidth === b_gd.strokeWidth,
  hoveredEdgeBrightens: a_ab && a_ab.opacity > b_ab.opacity * 1.5,
  hoveredEdgeThickens: a_ab && a_ab.strokeWidth > b_ab.strokeWidth * 1.2,
  otherEdgeDims: a_gd && a_gd.opacity < b_gd.opacity * 0.6,
  otherEdgeStaysThin: a_gd && a_gd.strokeWidth === b_gd.strokeWidth,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge focus:`, JSON.stringify(results),
  `\n  before α→β=${JSON.stringify(b_ab)} γ→δ=${JSON.stringify(b_gd)}`,
  `\n  during α→β=${JSON.stringify(a_ab)} γ→δ=${JSON.stringify(a_gd)}`);
process.exit(ok ? 0 : 1);
