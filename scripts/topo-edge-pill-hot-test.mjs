/* Round 150 verification: R119 edge filter pill extends the hot-
 * lane convention. When the pinned edge has count >= 10, the
 * count tspan inside the pill flips to amber + 700 weight, and
 * the tooltip grows a "hot lane · ≥ 10" marker.
 *
 * 4th hot-lane surface now active:
 *   R126 canvas badge       → amber stroke when count >= 10
 *   R127 recent-row count   → amber + bold tspan
 *   R129 panel header tail  → "· N hot" amber suffix
 *   R150 edge filter pill   → amber count tspan + tooltip marker
 *
 * All four use the same hotStroke palette (#d97706 light / #fbbf24
 * dark) so the eye instantly recognises hot signal across
 * surfaces.
 *
 * Two test states:
 *   - Pin a hot edge (count >= 10):
 *     - data-active-filter-edge-hot="true"
 *     - data-active-filter-edge-count-hot tspan present
 *     - tspan color = amber, weight = 700
 *     - title contains "hot lane · ≥ 10"
 *   - Pin a warm edge (count < 10):
 *     - data-active-filter-edge-hot="false"
 *     - data-active-filter-edge-count tspan present (non-hot)
 *     - title does NOT contain "hot lane"
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
    mk('alpha', 'working'), mk('beta', 'working'), mk('gamma', 'idle'),
  ] } });
});

const now = Date.now();
const mkMsg = (id, from, to, ageMs) => ({
  id, from_alias: from, to_alias: to, content: 'hi',
  network_id: 'default', created_at: new Date(now - ageMs).toISOString(),
});
const msgs = [];
// 12 alpha→beta = HOT (count >= 10)
for (let i = 0; i < 12; i++) msgs.push(mkMsg(`a${i}`, 'alpha', 'beta',  20000 + i * 500));
// 4 beta→gamma = warm
for (let i = 0; i < 4; i++)  msgs.push(mkMsg(`b${i}`, 'beta',  'gamma', 30000 + i * 500));
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-recent-row="alpha->beta"]', { timeout: 10000 });
await page.waitForTimeout(400);

const inspectPill = () => page.evaluate(() => {
  const pill = document.querySelector('[data-active-filter="edge"]');
  if (!pill) return null;
  const hotTspan = pill.querySelector('[data-active-filter-edge-count-hot]');
  const warmTspan = pill.querySelector('[data-active-filter-edge-count]');
  return {
    hot: pill.getAttribute('data-active-filter-edge-hot'),
    title: pill.getAttribute('title'),
    hotTspanText:   hotTspan?.textContent?.trim(),
    hotTspanStyle:  hotTspan?.getAttribute('style'),
    warmTspanText:  warmTspan?.textContent?.trim(),
    matchCount:     pill.getAttribute('data-filter-match-count'),
  };
});

// Pin hot edge alpha→beta (12 msgs)
await page.locator('[data-recent-row="alpha->beta"]').click();
await page.waitForTimeout(250);
const hot = await inspectPill();

// Unpin → pin warm edge beta→gamma (4 msgs)
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.locator('[data-recent-row="beta->gamma"]').click();
await page.waitForTimeout(250);
const warm = await inspectPill();

await browser.close();

// cyber theme amber #fbbf24 = rgb(251, 191, 36)
const amberInStyle = (s) =>
  !!s && (/rgba?\(251,\s*191,\s*36/i.test(s) || /#fbbf24/i.test(s));

const results = {
  // Hot edge pinned (alpha→beta, 12 msgs)
  hot_pillPresent:       hot !== null,
  hot_attrTrue:          hot?.hot === 'true',
  hot_matchCount12:      hot?.matchCount === '12',
  hot_tspanHasCount:     hot?.hotTspanText?.includes('12') === true,
  hot_tspanAmberColor:   amberInStyle(hot?.hotTspanStyle || ''),
  hot_tspanWeight700:    (hot?.hotTspanStyle || '').includes('font-weight: 700'),
  hot_titleHotMarker:    (hot?.title || '').includes('hot lane'),
  hot_noWarmTspan:       hot?.warmTspanText === undefined,

  // Warm edge pinned (beta→gamma, 4 msgs)
  warm_pillPresent:      warm !== null,
  warm_attrFalse:        warm?.hot === 'false',
  warm_matchCount4:      warm?.matchCount === '4',
  warm_tspanHasCount:    warm?.warmTspanText?.includes('4') === true,
  warm_noHotTspan:       warm?.hotTspanText === undefined,
  warm_titleNoHotMarker: !(warm?.title || '').includes('hot lane'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge pill hot:`, JSON.stringify(results),
  `\n  hot=`,  hot,
  `\n  warm=`, warm);
process.exit(ok ? 0 : 1);
