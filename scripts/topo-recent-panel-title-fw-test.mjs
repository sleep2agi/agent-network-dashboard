/* Round 482 verification: recent-signal panel title "recent signal"
 * gains fontWeight 700 → 800 on activeEdgeKey (any row hover or pin).
 * Extends the "data tightens under attention" pattern to the panel-
 * title scope alongside R345's existing letter-spacing tween on
 * panel-chrome hover.
 *
 * Contract:
 *   - at rest (no row hover/pin): data-recent-panel-title-fw='700'
 *     + data-recent-panel-title-active='false'
 *   - click a recent-signal row hitbox to pin: title fw flips to '800'
 *     + active='true'
 *   - click again to unpin: title returns to fw='700'
 *   - source-file conditional wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const nowIso = () => new Date().toISOString();
const sessionFresh = new Date(Date.now() - 60 * 1000).toISOString();

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
    created_at: sessionFresh, updated_at: sessionFresh, last_seen_at: sessionFresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('b·1', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: {
  messages: [
    { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 'ping', created_at: nowIso() },
    { id: 'm2', from_alias: 'b·1', to_alias: 'a·1', content: 'pong', created_at: nowIso() },
  ],
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-panel-title]', { timeout: 15000 });
await page.waitForTimeout(800);

const readTitle = () => page.evaluate(() => {
  const t = document.querySelector('[data-recent-panel-title]');
  if (!t) return null;
  return {
    fw:     t.getAttribute('data-recent-panel-title-fw'),
    active: t.getAttribute('data-recent-panel-title-active'),
    liveFW: t.getAttribute('font-weight'),
  };
});

const rest = await readTitle();
// Click first recent-row to pin
await page.click('[data-recent-row]');
await page.waitForTimeout(400);
const pinned = await readTitle();
// Click again to unpin (toggles pinnedEdgeKey).
// After the click, move pointer off the row — otherwise
// hoveredEdgeKey still holds even after pin clears
// (activeEdgeKey = hoveredEdgeKey ?? pinnedEdgeKey).
await page.click('[data-recent-row]');
await page.mouse.move(50, 50); // off the recent-signal panel
await page.waitForTimeout(400);
const restAgain = await readTitle();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFwConditional = /fontWeight=\{activeEdgeKey \? '800' : '700'\}/.test(src);
const sourceFwTween = /font-weight 200ms ease-out/.test(src);
const sourceDataAttr  = /data-recent-panel-title-fw=\{activeEdgeKey \?/.test(src);

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
console.log(`${ok ? '✅' : '❌'} recent-panel title fw 700→800:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned:', JSON.stringify(pinned),
  '\n  rest again:', JSON.stringify(restAgain));
process.exit(ok ? 0 : 1);
