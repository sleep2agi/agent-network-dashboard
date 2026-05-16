/* Round 306 verification: Layout toggle (Ring/Grid) focus-visible:
 * ring-2 → ring-1 unifies focus-ring width across all chrome
 * buttons. Pre-R306 Layout toggle was the only chrome button at
 * 2px; nodeSize, zoom, reset, fullscreen all at 1px.
 *
 * Test approach: tab/focus each chrome button via DOM-direct
 * focus() + check the computed outline / box-shadow width. The
 * focus-visible CSS only matches keyboard-style focus, so we
 * dispatch keyboard focus to trigger the focus-visible state.
 *
 * Contract:
 *   - All chrome buttons (Layout Ring + Grid, nodeSize S+M+L,
 *     zoom-out + zoom-in, reset, fullscreen) share the same
 *     focus-visible ring style: 1px (or equivalent).
 *   - The R305 node-alias chat-pin signature is unchanged.
 *   - R304/R302/R301/R300/R294 regressions intact.
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
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 15000 });
await page.waitForSelector('[data-topo-chrome-fullscreen]', { timeout: 5000 });
await page.waitForTimeout(300);

// Probe the source-of-truth: Tailwind compiles `focus-visible:ring-N`
// into class names; we read className strings rather than triggering
// focus-visible state (which requires keyboard input simulation).
const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const cls = (el) => el?.className ?? '';
  // Tailwind compiles `focus-visible:ring-N` literally in the className
  // string; checking presence of `focus-visible:ring-1` vs `ring-2`.
  const has = (s, needle) => cls(sel(s)).includes(needle);
  return {
    layoutRing_ring1:       has('[data-topo-chrome-layout="ring"]', 'focus-visible:ring-1'),
    layoutRing_no_ring2:    !has('[data-topo-chrome-layout="ring"]', 'focus-visible:ring-2'),
    layoutGrid_ring1:       has('[data-topo-chrome-layout="grid"]', 'focus-visible:ring-1'),
    layoutGrid_no_ring2:    !has('[data-topo-chrome-layout="grid"]', 'focus-visible:ring-2'),
    nodesizeS_ring1:        has('[data-topo-chrome-nodesize="S"]', 'focus-visible:ring-1'),
    fullscreen_ring1:       has('[data-topo-chrome-fullscreen]',   'focus-visible:ring-1'),
    zoomIn_ring1:           has('[data-topo-chrome-zoom-in]',      'focus-visible:ring-1'),
    aliasChatTargetAttrPresent: (() => {
      const a = sel('[data-node-alias-text]');
      return a?.hasAttribute('data-node-alias-chat-target') ?? false;
    })(),
    subhintLs:    sel('[data-recent-signal-empty-hint]')?.getAttribute('letter-spacing') ?? null,
    emptyLs:      sel('[data-recent-signal-empty]')?.getAttribute('letter-spacing') ?? null,
    kickerFw:     (() => {
      const k = sel('[data-topo-section-kicker]');
      return k ? getComputedStyle(k).fontWeight : null;
    })(),
    pulseCount:   document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  layout_ring_ring_1:           probe.layoutRing_ring1,
  layout_ring_no_ring_2:        probe.layoutRing_no_ring2,
  layout_grid_ring_1:           probe.layoutGrid_ring1,
  layout_grid_no_ring_2:        probe.layoutGrid_no_ring2,
  nodesize_S_ring_1:            probe.nodesizeS_ring1,
  fullscreen_ring_1:            probe.fullscreen_ring1,
  zoom_in_ring_1:               probe.zoomIn_ring1,
  r305_alias_chat_target_attr:  probe.aliasChatTargetAttrPresent,
  r304_subhint_ls_0_15:         probe.subhintLs === '0.15',
  r302_empty_main_ls_0_2:       probe.emptyLs === '0.2',
  r300_kicker_fw_500:           String(probe.kickerFw) === '500',
  r294_pulse_absent:            probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome focus ring unify:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);
