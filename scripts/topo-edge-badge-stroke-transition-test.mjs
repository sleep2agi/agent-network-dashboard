/* Round 188 verification: edge badge stroke + stroke-width
 * transitions on hot-lane threshold crossing.
 *
 * Pre-R188 the badge had `transition: r 180ms ease-out` (from
 * R164) but stroke/strokeWidth snapped when:
 *   - count crossed 10 (R126 cyan ↔ amber + 1 ↔ 2)
 *   - user clicked to pin (R121 cyan ↔ legendHeadline + 1 ↔ 2)
 *
 * R188 extends the transition list:
 *   r 180ms, stroke 300ms, stroke-width 300ms
 *
 * Test:
 *   1. Mock 2 edges: alpha→beta (count=4, not hot),
 *      alpha→gamma (count=12, hot)
 *   2. Probe both badges in idle state:
 *      - cold badge: stroke=#67e8f9 (flowEdge cyan), strokeWidth=1
 *      - hot badge: stroke=#fbbf24 (hotStroke cyber amber), strokeWidth=2
 *   3. Both badges carry transition string including all three:
 *      r 180ms, stroke 300ms, stroke-width 300ms
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 4 sessions so node midpoints are well-separated from hub
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});

const now = Date.now();
const msgs = [];
// alpha→beta: 4 msgs (cold; count >= 3 to render badge, < 10 not hot)
for (let i = 0; i < 4; i++) {
  msgs.push({ id: `cold${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (10000 + i * 100)).toISOString() });
}
// alpha→gamma: 12 msgs (hot; count >= 10)
for (let i = 0; i < 12; i++) {
  msgs.push({ id: `hot${i}`, from_alias: 'alpha', to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - (20000 + i * 100)).toISOString() });
}
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-count-badge]', { timeout: 10000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const badges = [...document.querySelectorAll('[data-edge-count-badge]')];
  return badges.map(b => {
    const circle = b.querySelector('circle');
    return {
      key:         b.getAttribute('data-edge-count-badge'),
      hot:         b.getAttribute('data-edge-count-badge-hot'),
      stroke:      circle?.getAttribute('stroke'),
      strokeWidth: parseFloat(circle?.getAttribute('stroke-width') || ''),
      transition:  circle?.style?.transition || getComputedStyle(circle).transition,
    };
  });
});

await browser.close();

const cold = probe.find(p => p.hot === 'false');
const hot  = probe.find(p => p.hot === 'true');

const hasTransition = (s, prop) => {
  const t = s?.transition || '';
  return t.includes(`${prop} 300ms`) ||
         new RegExp(`${prop}\\s+0\\.3s|${prop}\\s+300ms`).test(t);
};
const hasR180 = (s) => {
  const t = s?.transition || '';
  return t.includes('r 180ms') || /(^|[\s,])r\s+(180ms|0\.18s)/.test(t);
};

const results = {
  two_badges_present:    probe.length === 2,
  cold_badge_found:      cold !== undefined,
  hot_badge_found:       hot !== undefined,
  cold_stroke_cyan:      cold?.stroke === '#67e8f9',
  cold_strokeWidth_1:    cold?.strokeWidth === 1,
  hot_stroke_amber:      hot?.stroke === '#fbbf24',
  hot_strokeWidth_2:     hot?.strokeWidth === 2,
  cold_has_r_transition:        hasR180(cold),
  cold_has_stroke_transition:   hasTransition(cold, 'stroke'),
  cold_has_strokewidth_transition: hasTransition(cold, 'stroke-width'),
  hot_has_r_transition:         hasR180(hot),
  hot_has_stroke_transition:    hasTransition(hot, 'stroke'),
  hot_has_strokewidth_transition: hasTransition(hot, 'stroke-width'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge badge stroke transition:`, JSON.stringify(results),
  `\n  cold:`, cold,
  `\n  hot:`, hot);
process.exit(ok ? 0 : 1);
