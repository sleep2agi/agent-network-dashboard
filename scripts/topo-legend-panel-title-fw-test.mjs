/* Round 483 verification: legend panel title "legend" gains
 * fontWeight 700 → 800 on pinnedStatus. Mirrors R482's idiom at
 * the legend panel scope. Together R482 + R483 close the panel-
 * title symmetry on the "data tightens under attention" pattern.
 *
 * Contract:
 *   - rest (no pinned status): fw='700' + active='false'
 *   - click a legend-row hitbox to pin status filter: fw flips
 *     to '800' + active='true'
 *   - click again + mouse-move-off to release: back to fw='700'
 *   - source-file conditional wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('a·3', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-panel-title]', { timeout: 15000 });
await page.waitForTimeout(500);

const readTitle = () => page.evaluate(() => {
  const t = document.querySelector('[data-legend-panel-title]');
  if (!t) return null;
  return {
    fw:     t.getAttribute('data-legend-panel-title-fw'),
    active: t.getAttribute('data-legend-panel-title-active'),
    liveFW: t.getAttribute('font-weight'),
  };
});

const rest = await readTitle();
// Click a legend-row tinted hitbox to set pinnedStatus
await page.click('[data-legend-row-tinted]');
await page.waitForTimeout(400);
const pinned = await readTitle();
// Click again + move pointer away (per R482 gotcha note)
await page.click('[data-legend-row-tinted]');
await page.mouse.move(50, 50);
await page.waitForTimeout(400);
const restAgain = await readTitle();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFwConditional = /fontWeight=\{pinnedStatus \? '800' : '700'\}/.test(src);
const sourceFwTween       = /font-weight 200ms ease-out/.test(src);
const sourceDataAttr      = /data-legend-panel-title-fw=\{pinnedStatus \?/.test(src);

await browser.close();

const restIs700      = rest?.fw === '700' && rest?.active === 'false' && rest?.liveFW === '700';
const pinIs800       = pinned?.fw === '800' && pinned?.active === 'true' && pinned?.liveFW === '800';
const restAgainIs700 = restAgain?.fw === '700' && restAgain?.active === 'false' && restAgain?.liveFW === '700';

const results = {
  rest_is_700_inactive:     restIs700,
  pin_flips_to_800_active:  pinIs800,
  unpin_back_to_700:        restAgainIs700,
  source_fw_conditional:    sourceFwConditional,
  source_fw_tween:          sourceFwTween,
  source_data_attr:         sourceDataAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend-panel title fw 700→800:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned:', JSON.stringify(pinned),
  '\n  rest again:', JSON.stringify(restAgain));
process.exit(ok ? 0 : 1);
