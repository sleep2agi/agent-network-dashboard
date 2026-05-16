/* Round 258 verification: recent-signal panel empty-state re-centered
 * within the post-R256 88-tall panel.
 *
 * Pre-R256 (panel height 84):
 *   panel mid-line = (0 + 84) / 2 = 42
 *   main "no flow yet" at y=54  → +12 below mid
 *   hint "send a..."  at y=68  → +26 below mid
 *   Optically balanced for an 84-tall panel.
 *
 * Post-R256 (panel height 88) — pre-R258:
 *   panel mid-line = (0 + 88) / 2 = 44
 *   main at y=54  → +10 below mid (drifted 2px high)
 *   hint at y=68  → +24 below mid (drifted 2px high)
 *   Empty state visually drifted up after the height bump.
 *
 * Post-R258:
 *   main y=54 → y=56  (+2)
 *   hint y=68 → y=70  (+2)
 *   New offsets: +12 / +26 below mid — restored optical balance.
 *
 * Test scope:
 *   1. Empty state mounts visible (flowLinks.length === 0).
 *   2. Main text y === 56 (was 54).
 *   3. Hint text y === 70 (was 68).
 *   4. Panel rect height === 88 (regression — R256 holds).
 *   5. Offsets-from-mid: (main_y - panel_height/2) === 12 (matches
 *      original R45 optical placement).
 *   6. R200 SMIL breath continues — animate child still attached.
 *   7. Hint baseline still sits 12px above the footer (visible when
 *      flowLinks.length > 3 — but in empty state footer is invisible
 *      anyway; just verify y=70 < 82).
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'),
  ] } });
});
// Zero messages → flowLinks.length === 0 → empty state visible.
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForSelector('[data-recent-signal-empty]',       { timeout: 10000 });
await page.waitForSelector('[data-recent-signal-empty-hint]',  { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const panelG = document.querySelector('[data-topo-panel="recent"]');
  const rect   = panelG?.querySelector('rect');
  const wrap   = document.querySelector('[data-recent-signal-empty-wrapper]');
  const main   = document.querySelector('[data-recent-signal-empty]');
  const hint   = document.querySelector('[data-recent-signal-empty-hint]');
  const mainAnim = main?.querySelector('animate');
  const hintAnim = hint?.querySelector('animate');
  return {
    panelH:        rect ? +rect.getAttribute('height') : null,
    wrapperVisible: wrap?.getAttribute('data-recent-signal-empty-visible'),
    mainY:         main ? +main.getAttribute('y') : null,
    hintY:         hint ? +hint.getAttribute('y') : null,
    mainHasBreath: !!mainAnim,
    hintHasBreath: !!hintAnim,
  };
});
await browser.close();

const midLine        = probe.panelH != null ? probe.panelH / 2 : null;
const mainOffsetMid  = (probe.mainY != null && midLine != null) ? probe.mainY - midLine : null;
const hintOffsetMid  = (probe.hintY != null && midLine != null) ? probe.hintY - midLine : null;

const results = {
  panel_h_88:                       probe.panelH === 88,
  wrapper_empty_visible_true:       probe.wrapperVisible === 'true',
  main_y_moved_to_56:               probe.mainY === 56,
  hint_y_moved_to_70:               probe.hintY === 70,
  main_offset_from_mid_is_12:       mainOffsetMid === 12,
  hint_offset_from_mid_is_26:       hintOffsetMid === 26,
  main_smil_breath_present:         probe.mainHasBreath === true,
  hint_smil_breath_present:         probe.hintHasBreath === true,
  hint_above_footer_y82:            probe.hintY != null && probe.hintY < 82,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent panel empty-state re-center:`, JSON.stringify(results),
  '\n  panelH:', probe.panelH, 'midLine:', midLine,
  '\n  mainY:', probe.mainY, '(offset-from-mid', mainOffsetMid, ')',
  '\n  hintY:', probe.hintY, '(offset-from-mid', hintOffsetMid, ')');
process.exit(ok ? 0 : 1);
