/* Round 332 verification: minimap container rounded-md → rounded-lg
 * (6 → 8 px) — extends the R330-R331 corner-radius cascade.
 *
 * Size-hierarchy gradient now:
 *   outer wrapper      rounded-xl   12 px  (R330)
 *   inner SVG panels   rx=10        10 px  (R331)
 *   minimap overlay    rounded-lg    8 px  (R332, this round)
 *   inner detail card  rx=8          8 px  (codex 8f981a9)
 *   node label card    rx=6          6 px
 *   group label hit    rx=4          4 px
 *   row hover rect     rx=3          3 px
 *
 * Contract:
 *   - [data-topo-minimap] outer container has className containing
 *     'rounded-lg' (not 'rounded-md').
 *   - Computed border-top-left-radius === '8px'.
 *   - The minimap only mounts when view is non-default (zoom != 1 or
 *     pan != 0); we trigger zoom-in click to surface it.
 *   - R331 recent-panel rx=10 + R330 wrapper rounded-xl regressions.
 *   - R317 / R318 / R294 chrome + pulse regressions intact.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 15000 });
// Trigger zoom-in so view goes non-default and minimap mounts.
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(300);
await page.waitForSelector('[data-topo-minimap]', { timeout: 5000 });
await page.waitForTimeout(200);

const probe = await page.evaluate(() => {
  const minimap = document.querySelector('[data-topo-minimap]');
  const wrapper = document.querySelector('[data-topo-wrapper]');
  const recent = document.querySelector('[data-topo-panel="recent"]');
  return {
    minimapClass:        minimap?.className ?? '',
    minimapRadius:       minimap ? getComputedStyle(minimap).borderTopLeftRadius : null,
    wrapperClass:        wrapper?.className ?? '',
    recentRx:            recent?.querySelector('rect')?.getAttribute('rx') ?? null,
    layoutInactiveCls:   document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:     document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:          document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  minimap_has_rounded_lg:     probe.minimapClass.includes('rounded-lg') && !probe.minimapClass.includes('rounded-md'),
  minimap_radius_8px:         probe.minimapRadius === '8px',
  // R331 panel rx=10 regression.
  r331_recent_rx_10:          probe.recentRx === '10' || probe.recentRx === null, // null OK if panel hidden
  // R330 wrapper regression.
  r330_wrapper_rounded_xl:    probe.wrapperClass.includes('rounded-xl'),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:     probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:    probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:          probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap radius rounded-lg:`, JSON.stringify(results),
  '\n  minimap border-top-left-radius:', probe.minimapRadius,
  '\n  recent panel rx (regression):',   probe.recentRx);
process.exit(ok ? 0 : 1);
