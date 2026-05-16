/* Round 370 verification: hub hover-ring cyber opacity 0.7 → 0.8.
 * R177 designed the hub hover-ring at opacity-0 → 0.85 (light) / 0 →
 * 0.7 (cyber). The 15 % gap between themes meant cyber-theme users
 * got a noticeably softer hover cue than light-theme users against
 * backgrounds that should equalise (dark bg needs more luminance to
 * read as 'on'). R370 bumps cyber 0.7 → 0.8, narrowing the theme
 * gap to 5 % (light stays at 0.85).
 *
 * Contract (cyber theme):
 *   - Rest (hub NOT hovered): hub-hover-ring opacity attr === '0'.
 *   - Hover hub: opacity attr === '0.8'.
 *   - data-topo-hub-hover-ring-opacity === '0.8' on hover.
 *   - Pre-R370 invariants:
 *     * r=17 on hover (R177)
 *     * stroke=#10b981 (cyber, R253)
 *     * strokeWidth=1.5
 *     * pointerEvents:none
 *     * R177 r + opacity transitions preserved
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub-hover-ring]', { timeout: 15000 });
await page.waitForTimeout(300);

const restProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-hub-hover-ring]');
  const cs = r ? getComputedStyle(r) : null;
  return {
    opacityAttr:   r?.getAttribute('opacity') ?? null,
    opacityData:   r?.getAttribute('data-topo-hub-hover-ring-opacity') ?? null,
    rAttr:         r?.getAttribute('r') ?? null,
    radiusData:    r?.getAttribute('data-topo-hub-hover-ring-radius') ?? null,
    strokeAttr:    r?.getAttribute('stroke') ?? null,
    strokeWidthAttr: r?.getAttribute('stroke-width') ?? null,
    pointerEv:     cs?.pointerEvents ?? null,
  };
});

// Hover the hub group.
await page.hover('[data-topo-hub]');
await page.waitForTimeout(300);
const hoverProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-hub-hover-ring]');
  return {
    opacityAttr:  r?.getAttribute('opacity') ?? null,
    opacityData:  r?.getAttribute('data-topo-hub-hover-ring-opacity') ?? null,
    rAttr:        r?.getAttribute('r') ?? null,
    radiusData:   r?.getAttribute('data-topo-hub-hover-ring-radius') ?? null,
  };
});

await browser.close();

const results = {
  rest_opacity_0:         restProbe.opacityAttr === '0',
  rest_opacity_data_0:    restProbe.opacityData === '0',
  rest_r_14:              restProbe.rAttr === '14',                    // R177 rest
  rest_radius_data_14:    restProbe.radiusData === '14',
  rest_stroke_cyber:      restProbe.strokeAttr === '#10b981',          // R253 cyber
  rest_stroke_width_1_5:  restProbe.strokeWidthAttr === '1.5',         // R51 sentinel reserved but R177
  pointer_events_none:    restProbe.pointerEv === 'none',
  hover_opacity_0_8:      hoverProbe.opacityAttr === '0.8',            // R370 cyber bump
  hover_opacity_data_0_8: hoverProbe.opacityData === '0.8',
  hover_r_17:             hoverProbe.rAttr === '17',                   // R177 hover lift
  hover_radius_data_17:   hoverProbe.radiusData === '17',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub hover-ring opacity 0.7 → 0.8 (cyber):`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
