/* Round 741 — animation temporal modes catalog. 8TH orthogonal
 * meta-doc axis on the topology introspection layer. Octagon:
 *
 *   R710 rolodex              (cadences)              breath
 *   R716 dual-axis-surfaces   (axes)                  breath
 *   R717 patterns             (structural shapes)     cross-family
 *   R720 tiers                (functional roles)      breath
 *   R723 triple-axis-surfaces (multi-axis)            breath
 *   R729 axis-count-stats     (aggregate stats)       breath + cross-family
 *   R732 a11y-titles          (accessible names)      a11y
 *   R741 animation-temporal-modes (lifecycle)         cross-family ← this round
 *
 * Documents WHEN animations run rather than HOW. Three temporal
 * modes after R740:
 *   infinite-rest  → breath family   18 members
 *   infinite-sweep → ambient family   3 members
 *   one-shot-mount → entrance family  1 member
 *
 * Cross-validation against runtime:
 *   - infinite-rest member count: rolodex (R710) flat anchor count = 18
 *   - infinite-sweep member count: scan-beam-trio (R717) anchors = 3
 *     OR distinct anchors across ambient patterns in R717
 *   - one-shot-mount member count: 1 (canvas root entrance only)
 *
 * Assertions:
 *   - attr present on root <svg>
 *   - JSON parses to Array of exactly 3 entries
 *   - shape: each entry has {mode, family, members, examples}
 *   - modes sorted = ['infinite-rest', 'infinite-sweep', 'one-shot-mount']
 *   - families sorted = ['ambient', 'breath', 'entrance']
 *   - members are positive integers
 *   - examples is non-empty array of strings (≤3 per mode)
 *   - Cross-check: infinite-rest.members === R710 rolodex anchor count
 *   - Cross-check: infinite-sweep.members === scan-beam-trio anchor count (3)
 *   - Cross-check: one-shot-mount.members === 1
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

const runtimeAttrs = await page.evaluate(() => {
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return {
    modes:    svg?.getAttribute('data-topo-animation-temporal-modes') ?? null,
    rolodex:  svg?.getAttribute('data-topo-respiratory-rolodex')      ?? null,
    patterns: svg?.getAttribute('data-topo-respiratory-patterns')     ?? null,
  };
});

await browser.close();

let modes = null;
let rolodex = null;
let patterns = null;
let parseError = null;
try {
  modes    = JSON.parse(runtimeAttrs.modes    ?? '');
  rolodex  = JSON.parse(runtimeAttrs.rolodex  ?? '');
  patterns = JSON.parse(runtimeAttrs.patterns ?? '');
} catch (e) {
  parseError = String(e);
}

const validShape = Array.isArray(modes)
  ? modes.every(m => m && typeof m === 'object'
      && typeof m.mode === 'string' && m.mode.length > 0
      && typeof m.family === 'string' && m.family.length > 0
      && Number.isInteger(m.members) && m.members > 0
      && Array.isArray(m.examples) && m.examples.length > 0 && m.examples.length <= 3
      && m.examples.every(e => typeof e === 'string' && e.length > 0))
  : false;

const modeNames = Array.isArray(modes) ? modes.map(m => m.mode).sort() : [];
const familyNames = Array.isArray(modes) ? modes.map(m => m.family).sort() : [];
const expectedModes = ['infinite-rest', 'infinite-sweep', 'one-shot-mount'];
const expectedFamilies = ['ambient', 'breath', 'entrance'];

const infRest = Array.isArray(modes) ? modes.find(m => m.mode === 'infinite-rest') : null;
const infSweep = Array.isArray(modes) ? modes.find(m => m.mode === 'infinite-sweep') : null;
const oneShot = Array.isArray(modes) ? modes.find(m => m.mode === 'one-shot-mount') : null;

const rolodexAnchorCount = rolodex && typeof rolodex === 'object'
  ? Object.values(rolodex).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0)
  : -1;

const scanBeamTrio = Array.isArray(patterns) ? patterns.find(p => p.name === 'scan-beam-trio') : null;
const scanBeamTrioAnchorCount = Array.isArray(scanBeamTrio?.anchors) ? scanBeamTrio.anchors.length : -1;

const results = {
  attr_present:                    !!runtimeAttrs.modes,
  json_parses:                     modes !== null && parseError === null,
  is_array:                        Array.isArray(modes),
  has_3_entries:                   Array.isArray(modes) && modes.length === 3,
  shape_valid:                     validShape,
  modes_match_expected:            JSON.stringify(modeNames) === JSON.stringify(expectedModes),
  families_match_expected:         JSON.stringify(familyNames) === JSON.stringify(expectedFamilies),
  inf_rest_breath_pair:            infRest?.family === 'breath',
  inf_sweep_ambient_pair:          infSweep?.family === 'ambient',
  one_shot_entrance_pair:          oneShot?.family === 'entrance',
  inf_rest_matches_rolodex_count:  infRest?.members === rolodexAnchorCount,
  inf_sweep_matches_trio_count:    infSweep?.members === scanBeamTrioAnchorCount,
/* R742 — entrance family grew from 1 → 2 members (title-block joined
 * canvas root). The R741-time invariant `=== 1` is invalidated;
 * widen to `>= 1` (entrance family is at least one member) and add
 * a separate `oneShot_count_is_2` reflecting the post-R742 reality. */
  one_shot_count_at_least_1:       (oneShot?.members ?? 0) >= 1,
  one_shot_count_is_2:              oneShot?.members === 2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R741 animation temporal modes catalog (8th meta-doc — octagon, lifecycle dimension):`,
  JSON.stringify(results, null, 2),
  `\n  modes: ${JSON.stringify(modes)}`,
  `\n  rolodex anchors: ${rolodexAnchorCount} · scan-beam-trio anchors: ${scanBeamTrioAnchorCount}`,
  parseError ? `\n  parseError: ${parseError}` : '');
process.exit(ok ? 0 : 1);
