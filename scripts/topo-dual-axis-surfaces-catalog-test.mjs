/* Round 716 — dual-axis surfaces catalog attr on canvas root. Companion
 * to R710 rolodex catalog. Lists the 5 dual-axis surfaces (6 underlying
 * elements counting panel-pair as 2) with their cadences and axes.
 *
 * Assertions:
 *   - attr present on root <svg>
 *   - JSON parses to an Array
 *   - exactly 6 entries (4 unique surfaces but panel-pair = 2)
 *   - each entry has { anchor, cadence_s, axes } shape
 *   - axes is non-empty Array<string>
 *   - opacity is the FIRST axis in every entry (preserves R699/R700/.../
 *     existing opacity-first establishment)
 *   - second axis is one of: transform-scale, letter-spacing, font-size
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

const runtimeAttr = await page.evaluate(() => {
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return svg?.getAttribute('data-topo-respiratory-dual-axis-surfaces') ?? null;
});

await browser.close();

let parsed = null;
let parseError = null;
try {
  parsed = JSON.parse(runtimeAttr ?? '');
} catch (e) {
  parseError = String(e);
}

const validShapeAndOpacityFirst = Array.isArray(parsed)
  ? parsed.every(e => e && typeof e === 'object'
      && typeof e.anchor === 'string' && e.anchor.length > 0
      && typeof e.cadence_s === 'number' && e.cadence_s > 0
      && Array.isArray(e.axes) && e.axes.length >= 2
      && e.axes.every(a => typeof a === 'string' && a.length > 0)
      && e.axes[0] === 'opacity')
  : false;

const validSecondAxisChoices = Array.isArray(parsed)
  ? parsed.every(e => Array.isArray(e?.axes) && ['transform-scale', 'letter-spacing', 'font-size'].includes(e.axes[1]))
  : false;

const anchorNames = Array.isArray(parsed) ? parsed.map(e => e.anchor).sort() : [];
const expectedAnchors = ['H2', 'kicker', 'legend', 'recent', 'watermark', 'zoom-level'];

const results = {
  attr_present:                !!runtimeAttr,
  json_parses:                 parsed !== null && parseError === null,
  is_array:                    Array.isArray(parsed),
  has_6_entries:               Array.isArray(parsed) && parsed.length === 6,
  anchors_match_expected:      JSON.stringify(anchorNames) === JSON.stringify(expectedAnchors),
  shape_and_opacity_first:     validShapeAndOpacityFirst,
  second_axis_valid_choices:   validSecondAxisChoices,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R716 dual-axis surfaces catalog attr (companion to R710 rolodex — breath family meta-documentation closed):`,
  JSON.stringify(results, null, 2),
  `\n  parsed: ${JSON.stringify(parsed)}`,
  parseError ? `\n  parseError: ${parseError}` : '');
process.exit(ok ? 0 : 1);
