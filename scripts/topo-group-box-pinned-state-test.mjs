/* Round 68 verification: group-box rect has a 3-tier visual ladder:
 *  idle    → strokeWidth 1.5, dashed, ringStroke colour
 *  hovered → strokeWidth 2,   solid, legendAccent colour
 *  pinned  → strokeWidth 3,   solid, legendAccent colour (stronger)
 *
 * Plus `data-group-box-pinned` reflects the pinned state so external
 * tooling can spot a pinned box without inspecting computed CSS.
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
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'alpha1', status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha2', status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha3', status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'beta1',  status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'beta2',  status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 5, { timeout: 30000 });
await page.waitForTimeout(600);

const readAlphaBox = () => page.evaluate(() => {
  // Find the alpha group <g data-group="alpha"> and read its <rect>.
  const g = document.querySelector('g[data-group="alpha"]');
  if (!g) return null;
  const rect = g.querySelector('rect');
  if (!rect) return null;
  return {
    strokeWidth:    rect.getAttribute('stroke-width'),
    stroke:         rect.getAttribute('stroke'),
    dashArray:      rect.getAttribute('stroke-dasharray'),
    fillOpacity:    rect.getAttribute('fill-opacity'),
    pinnedAttr:     rect.getAttribute('data-group-box-pinned'),
  };
});

const idle = await readAlphaBox();

// Hover a member of alpha (alpha1) → group becomes hovered.
await page.locator('g[data-node="alpha1"]').hover();
await page.waitForTimeout(300);
const hovered = await readAlphaBox();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);

// Pin alpha via group label click.
await page.locator('g[data-group-label-hit="alpha"]').first().click({ force: true });
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const pinned = await readAlphaBox();

await browser.close();

const results = {
  idle_stroke15:        idle && idle.strokeWidth === '1.5',
  idle_dashed:          idle && (idle.dashArray || '').startsWith('6'),
  idle_pinnedFalse:     idle && idle.pinnedAttr === 'false',
  hovered_stroke2:      hovered && hovered.strokeWidth === '2',
  hovered_solid:        hovered && (hovered.dashArray === 'none' || hovered.dashArray === null),
  hovered_pinnedFalse:  hovered && hovered.pinnedAttr === 'false',
  pinned_stroke3:       pinned && pinned.strokeWidth === '3',
  pinned_solid:         pinned && (pinned.dashArray === 'none' || pinned.dashArray === null),
  pinned_pinnedTrue:    pinned && pinned.pinnedAttr === 'true',
  pinned_strongerFill:  pinned && hovered && parseFloat(pinned.fillOpacity) > parseFloat(hovered.fillOpacity),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-box pinned state:`, JSON.stringify(results),
  `\n  idle=`,    idle,
  `\n  hovered=`, hovered,
  `\n  pinned=`,  pinned);
process.exit(ok ? 0 : 1);
