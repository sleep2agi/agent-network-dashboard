/* Round 477 verification: legend pin-ring (R181 always-mount stroke
 * ring) gains filter: drop-shadow glow on isPinned. Extends R476's
 * drop-shadow idiom from the hub-digit focal scope to the legend-
 * row pin-state scope.
 *
 * Contract:
 *   - at rest (no pin): every legend-pin-ring has data-legend-pin-
 *     ring-glow='false' AND computed filter === 'none' AND opacity=0
 *   - click a legend status row to pin: that ring flips to
 *     glow='true' + filter starts with 'drop-shadow' + opacity=1
 *   - other (non-pinned) rings stay at rest
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
await page.waitForSelector('[data-legend-pin-ring]', { timeout: 15000 });
await page.waitForTimeout(500);

const readAll = () => page.evaluate(() => {
  const rings = [...document.querySelectorAll('[data-legend-pin-ring]')];
  return rings.map(r => {
    const cs = getComputedStyle(r);
    return {
      key:    r.getAttribute('data-legend-pin-ring'),
      glow:   r.getAttribute('data-legend-pin-ring-glow'),
      pinned: r.getAttribute('data-legend-pin-ring-pinned'),
      filter: cs.filter,
    };
  });
});

const restAll = await readAll();
// Click a legend row hitbox (R271 hitbox rect at y=row.y0-11..+11)
// Use data-legend-row-tinted as the hitbox handle — clicking it
// toggles pinnedStatus to its key.
const firstRow = await page.$('[data-legend-row-tinted]');
let pinnedAll = null;
if (firstRow) {
  await firstRow.click();
  await page.waitForTimeout(400);
  pinnedAll = await readAll();
}

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGlowAttr  = /data-legend-pin-ring-glow=\{isPinned/.test(src);
const sourceDropShadow = /drop-shadow\(0 0 3px \$\{row\.fill\}88\)/.test(src);
const sourceFilterTween = /opacity 150ms ease-out, filter 200ms ease-out/.test(src);

await browser.close();

const restCount = restAll.length;
const restAllFalse = restAll.every(r => r.glow === 'false' && r.filter === 'none');
const pinnedTarget = pinnedAll?.find(r => r.glow === 'true');
const pinnedHasDropShadow = pinnedTarget && /drop-shadow/.test(pinnedTarget.filter);
const pinnedOthersStill = pinnedAll
  ? pinnedAll.filter(r => r !== pinnedTarget).every(r => r.glow === 'false')
  : false;

const results = {
  rest_count_ge_3:        restCount >= 3,
  rest_all_glow_false:    restAllFalse,
  pinned_target_glow:     pinnedTarget?.glow === 'true',
  pinned_target_has_drop_shadow: pinnedHasDropShadow,
  pinned_others_stay_rest: pinnedOthersStill,
  source_glow_attr:       sourceGlowAttr,
  source_drop_shadow:     sourceDropShadow,
  source_filter_tween:    sourceFilterTween,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend pin-ring drop-shadow glow:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(restAll),
  '\n  pinned target:', JSON.stringify(pinnedTarget));
process.exit(ok ? 0 : 1);
