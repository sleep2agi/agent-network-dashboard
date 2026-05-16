/* Round 348 verification: panel rect opacity hover-state bump.
 * Recent-signal + legend panels both lift their fill opacity when
 * hoveredPanel === <self>. Cyber: 0.92 → 0.97. Light: 0.97 → 1.0.
 * Joins the panel-hover cue stack:
 *   - R135 drop-shadow boost
 *   - R345 panel title letter-spacing tween 0.3 → 0.4
 *   - R266 fill theme-flip
 *   - R348 rect opacity bump (this round)
 * Pure paint-level change — geometry-safe, bbox unchanged, so
 * topo-overlap-test invariants hold. The R247 transition list already
 * includes `opacity 200ms ease-out` so the value tween is automatic.
 *
 * Contract (cyber theme):
 *   - Rest: both panel rects opacity=0.92.
 *   - Hover recent: recent-panel rect opacity=0.97.
 *   - Hover legend: legend-panel rect opacity=0.97.
 *   - data-topo-panel-elevation selectors locate the rects (existing).
 *   - data-topo-panel-hovered toggles on parent <g> (existing R135).
 *   - Pre-R348 invariants: R331 rx=10 + R247 transition list intact.
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
// One message so the recent-signal panel mounts.
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-panel-elevation="recent"]', { timeout: 15000 });
await page.waitForSelector('[data-topo-panel-elevation="legend"]', { timeout: 5000 });
await page.waitForTimeout(400);

// Rest probe (cyber theme).
const restProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-panel-elevation="recent"]');
  const l = document.querySelector('[data-topo-panel-elevation="legend"]');
  return {
    recentOpacity:  r?.getAttribute('opacity') ?? null,
    legendOpacity:  l?.getAttribute('opacity') ?? null,
    recentRx:       r?.getAttribute('rx') ?? null,
    legendRx:       l?.getAttribute('rx') ?? null,
    recentTrans:    r ? getComputedStyle(r).transition : null,
    legendTrans:    l ? getComputedStyle(l).transition : null,
  };
});

// Hover recent panel.
await page.hover('[data-topo-panel="recent"]');
await page.waitForTimeout(300);
const recentHoverProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-panel-elevation="recent"]');
  return { opacity: r?.getAttribute('opacity') ?? null };
});

// Hover legend panel.
await page.hover('[data-topo-panel="legend"]');
await page.waitForTimeout(300);
const legendHoverProbe = await page.evaluate(() => {
  const l = document.querySelector('[data-topo-panel-elevation="legend"]');
  return { opacity: l?.getAttribute('opacity') ?? null };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  rest_recent_0_92:    restProbe.recentOpacity === '0.92',
  rest_legend_0_92:    restProbe.legendOpacity === '0.92',
  rest_recent_rx_10:   restProbe.recentRx === '10',
  rest_legend_rx_10:   restProbe.legendRx === '10',
  trans_recent_op:     hasTrans(restProbe.recentTrans, 'opacity'),
  trans_legend_op:     hasTrans(restProbe.legendTrans, 'opacity'),
  trans_recent_filter: hasTrans(restProbe.recentTrans, 'filter'),
  trans_legend_filter: hasTrans(restProbe.legendTrans, 'filter'),
  hover_recent_0_97:   recentHoverProbe.opacity === '0.97',
  hover_legend_0_97:   legendHoverProbe.opacity === '0.97',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel rect opacity hover bump:`, JSON.stringify(results),
  '\n  rest:        ', restProbe,
  '\n  hover recent:', recentHoverProbe,
  '\n  hover legend:', legendHoverProbe);
process.exit(ok ? 0 : 1);
