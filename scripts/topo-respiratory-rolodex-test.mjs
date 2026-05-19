/* Round 710 (milestone) — respiratory rolodex catalog attr on canvas
 * root. JSON catalog of all 16 breath anchors / 14 cadence tiers in
 * one attr read. Closes the 呼吸感 family vocabulary as DATA.
 *
 * Assertions:
 *   - attr present on the root <svg>
 *   - JSON parses to an object
 *   - exact catalog match: 14 cadence keys, 16 total anchors
 *   - shape: each value is an Array<string>, no empty arrays
 *   - cadence keys parse to integers, sorted ascending: 3/4/5/6/7/8/9/10/11/13/15/17/19/23
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
  return svg?.getAttribute('data-topo-respiratory-rolodex') ?? null;
});

await browser.close();

let parsed = null;
let parseError = null;
try {
  parsed = JSON.parse(runtimeAttr ?? '');
} catch (e) {
  parseError = String(e);
}

const expectedKeys = ['3','4','5','6','7','8','9','10','11','13','15','17','19','23'];
const cadenceKeys = parsed ? Object.keys(parsed).sort((a, b) => parseInt(a) - parseInt(b)) : [];
const totalAnchors = parsed ? Object.values(parsed).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0) : 0;
const allArraysNonEmpty = parsed ? Object.values(parsed).every(v => Array.isArray(v) && v.length > 0) : false;
const allValuesStrings = parsed ? Object.values(parsed).every(v => Array.isArray(v) && v.every(s => typeof s === 'string' && s.length > 0)) : false;

const results = {
  attr_present:           !!runtimeAttr,
  json_parses:            parsed !== null && parseError === null,
  has_14_cadence_keys:    cadenceKeys.length === 14,
  has_16_total_anchors:   totalAnchors === 16,
  keys_match_expected:    JSON.stringify(cadenceKeys) === JSON.stringify(expectedKeys),
  all_values_arrays:      allArraysNonEmpty,
  all_strings:            allValuesStrings,
  cadence_6_has_two:      Array.isArray(parsed?.["6"]) && parsed["6"].length === 2,
  cadence_8_has_two:      Array.isArray(parsed?.["8"]) && parsed["8"].length === 2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R710 respiratory rolodex catalog attr (milestone — breath family vocabulary as data):`,
  JSON.stringify(results, null, 2),
  `\n  parsed: ${JSON.stringify(parsed)}`,
  parseError ? `\n  parseError: ${parseError}` : '');
process.exit(ok ? 0 : 1);
