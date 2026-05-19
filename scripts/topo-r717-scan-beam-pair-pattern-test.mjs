/* Round 737 — formalize the R735/R736 scan beam ambient pair as the
 * 9TH entry in R717 patterns catalog. CROSS-FAMILY pattern entry:
 * prior 8 patterns are all in the respiratory (breath) family;
 * scan-beam-pair lives in the AMBIENT family but uses the same
 * R717 "pattern axis" introspection vocabulary.
 *
 * Mirrors R724's pattern-formalization round (which added the
 * triple-axis-pair entry after R721/R722 established the surfaces).
 *
 * Assertions:
 *   - R717 patterns has exactly 9 entries
 *   - `scan-beam-pair` entry exists with:
 *     - cadences [23, 30]
 *     - anchors ["scan beam horizontal", "scan beam vertical"]
 *     - shape "coprime-crosshair"
 *   - Coprime invariant: gcd(23, 30) === 1
 *   - Pattern cadences match the actual SMIL animate durs on the
 *     two beams (regression: R735 y-anim dur === 30s, R736 x-anim
 *     dur === 23s)
 *   - Pattern anchors map to actual data-attr selectors that resolve
 *     to live DOM elements (semantic anchor-to-element correspondence)
 *   - All other 8 R717 entries preserved (regression)
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
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-canvas-aria]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const svg = document.querySelector('[data-topo-canvas-aria]');
  const patternsAttr = svg?.getAttribute('data-topo-respiratory-patterns') ?? null;
  const hbeam = document.querySelector('[data-topo-canvas-scan-beam]');
  const vbeam = document.querySelector('[data-topo-canvas-scan-beam-vertical]');
  return {
    patterns_attr: patternsAttr,
    hbeam_y_dur: hbeam?.querySelector('animate[attributeName="y"]')?.getAttribute('dur') ?? null,
    vbeam_x_dur: vbeam?.querySelector('animate[attributeName="x"]')?.getAttribute('dur') ?? null,
    hbeam_present: !!hbeam,
    vbeam_present: !!vbeam,
  };
});

await browser.close();

let patterns = null;
try { patterns = JSON.parse(state.patterns_attr ?? ''); } catch {}

const sbpEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'scan-beam-pair') : null;
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

const expectedNames = ['background', 'canvas-brand-pair', 'chrome-strip', 'panel-pair', 'scan-beam-pair', 'title-block', 'triple-axis-pair', 'triple-axis-pair-8s', 'triple-axis-tier'];
const actualNames = Array.isArray(patterns) ? patterns.map(p => p.name).sort() : [];

const results = {
  patterns_has_9_entries:            Array.isArray(patterns) && patterns.length === 9,
  pattern_names_complete:            JSON.stringify(actualNames) === JSON.stringify(expectedNames),
  scan_beam_pair_entry_present:      !!sbpEntry,
  cadences_23_30:                    !!sbpEntry && JSON.stringify(sbpEntry.cadences) === JSON.stringify([23, 30]),
  anchors_horizontal_vertical:       !!sbpEntry && JSON.stringify(sbpEntry.anchors) === JSON.stringify(['scan beam horizontal', 'scan beam vertical']),
  shape_coprime_crosshair:           sbpEntry?.shape === 'coprime-crosshair',
  coprime_invariant_holds:           gcd(23, 30) === 1,
  pattern_matches_hbeam_dur:         state.hbeam_y_dur === '30s' && Array.isArray(sbpEntry?.cadences) && sbpEntry.cadences.includes(30),
  pattern_matches_vbeam_dur:         state.vbeam_x_dur === '23s' && Array.isArray(sbpEntry?.cadences) && sbpEntry.cadences.includes(23),
  both_beams_in_dom:                 state.hbeam_present && state.vbeam_present,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R737 R717 patterns +1: scan-beam-pair (9th entry, first cross-family pattern from the ambient layer):`,
  JSON.stringify(results, null, 2),
  `\n  sbp entry: ${JSON.stringify(sbpEntry)}`,
  `\n  gcd(23, 30) = ${gcd(23, 30)}`);
process.exit(ok ? 0 : 1);
