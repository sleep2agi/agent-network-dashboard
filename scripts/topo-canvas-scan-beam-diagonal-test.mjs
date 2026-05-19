/* Round 739 — diagonal scan beam (3rd member of ambient scan beam
 * family). Completes the trio from pair:
 *   R735 horizontal beam   30 s   (top → bottom)
 *   R736 vertical beam     23 s   (left → right)
 *   R739 diagonal beam     19 s   (NW → SE) ← this round
 *
 * Coprime invariants:
 *   gcd(19, 23) = 1
 *   gcd(19, 30) = 1
 *   gcd(23, 30) = 1
 * → 3 cadences pairwise coprime → never phase-lock as a trio.
 *
 * Assertions:
 *   - <line data-topo-canvas-scan-beam-diagonal> exists with 4 SMIL
 *     <animate> children on x1/y1/x2/y2 (all 19s, all repeatCount=indefinite)
 *   - opacity animate 0 → 0.06 → 0 at keyTimes 0/0.05/0.95/1, dur 19s
 *   - SVG <title>: "canvas scan beam diagonal · ambient sweep · 19s cycle"
 *   - data-topo-canvas-scan-beam-diagonal-active="true"
 *   - diagonal beam in background layer (rendered before nodes)
 *   - diagonal beam rendered AFTER vertical beam (trio document order)
 *   - all 3 beams alive (R735 + R736 regressions)
 *   - all 3 cadences pairwise coprime (Euclid check)
 *   - R717 patterns has 10 entries (was 9)
 *   - R717 includes new `scan-beam-trio` with shape "coprime-trio"
 *     and cadences [19, 23, 30]
 *   - R729 stats: patterns_count 10, ambient_patterns 2, ambient_cadences 3
 *   - R732 a11y catalog: 9 entries incl. diagonal beam
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
await page.waitForSelector('[data-topo-canvas-scan-beam-diagonal]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const dbeam = document.querySelector('[data-topo-canvas-scan-beam-diagonal]');
  const vbeam = document.querySelector('[data-topo-canvas-scan-beam-vertical]');
  const hbeam = document.querySelector('[data-topo-canvas-scan-beam]');
  if (!dbeam) return null;
  const getAnim = (el, attr) => el?.querySelector(`animate[attributeName="${attr}"]`);
  const x1A = getAnim(dbeam, 'x1');
  const y1A = getAnim(dbeam, 'y1');
  const x2A = getAnim(dbeam, 'x2');
  const y2A = getAnim(dbeam, 'y2');
  const opA = getAnim(dbeam, 'opacity');
  const dtitle = dbeam.querySelector(':scope > title');
  const svg = document.querySelector('[data-topo-canvas-aria]');
  const firstNode = svg?.querySelector('g[data-node]');
  const dbeamBeforeNodes = dbeam && firstNode
    ? (dbeam.compareDocumentPosition(firstNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    : null;
  const dbeamAfterVbeam = vbeam && dbeam
    ? (vbeam.compareDocumentPosition(dbeam) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    : null;
  return {
    dbeam_present:        !!dbeam,
    dbeam_active_attr:    dbeam?.getAttribute('data-topo-canvas-scan-beam-diagonal-active') ?? null,
    x1_dur: x1A?.getAttribute('dur'), x1_vals: x1A?.getAttribute('values'),
    y1_dur: y1A?.getAttribute('dur'), y1_vals: y1A?.getAttribute('values'),
    x2_dur: x2A?.getAttribute('dur'), x2_vals: x2A?.getAttribute('values'),
    y2_dur: y2A?.getAttribute('dur'), y2_vals: y2A?.getAttribute('values'),
    op_dur: opA?.getAttribute('dur'), op_vals: opA?.getAttribute('values'), op_kt: opA?.getAttribute('keyTimes'),
    dtitle_text:          dtitle?.textContent ?? null,
    dbeam_before_nodes:   dbeamBeforeNodes,
    dbeam_after_vbeam:    dbeamAfterVbeam,
    hbeam_present:        !!hbeam,
    vbeam_present:        !!vbeam,
    patterns:             svg?.getAttribute('data-topo-respiratory-patterns') ?? null,
    stats:                svg?.getAttribute('data-topo-respiratory-axis-count-stats') ?? null,
    a11y:                 svg?.getAttribute('data-topo-a11y-titles') ?? null,
  };
});

await browser.close();

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const coprime_trio = gcd(19, 23) === 1 && gcd(19, 30) === 1 && gcd(23, 30) === 1;

let patterns = null;
let stats = null;
let a11y = null;
try {
  patterns = JSON.parse(state?.patterns ?? '');
  stats    = JSON.parse(state?.stats    ?? '');
  a11y     = JSON.parse(state?.a11y     ?? '');
} catch {}

const trioEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'scan-beam-trio') : null;
const trioCorrect = !!trioEntry
  && JSON.stringify(trioEntry.cadences) === JSON.stringify([19, 23, 30])
  && trioEntry.shape === 'coprime-trio'
  && Array.isArray(trioEntry.anchors) && trioEntry.anchors.length === 3
  && trioEntry.anchors.includes('scan beam diagonal');

const results = {
  dbeam_line_present:               state?.dbeam_present === true,
  dbeam_active_true:                state?.dbeam_active_attr === 'true',
  x1_anim_full:                     state?.x1_dur === '19s' && state?.x1_vals === '-100;1100;-100',
  y1_anim_full:                     state?.y1_dur === '19s' && state?.y1_vals === '-100;780;-100',
  x2_anim_full:                     state?.x2_dur === '19s' && state?.x2_vals === '-30;1170;-30',
  y2_anim_full:                     state?.y2_dur === '19s' && state?.y2_vals === '-30;850;-30',
  op_anim_ramped:                   state?.op_dur === '19s' && state?.op_vals === '0;0.06;0.06;0' && state?.op_kt === '0;0.05;0.95;1',
  dbeam_a11y_title:                 state?.dtitle_text === 'canvas scan beam diagonal · ambient sweep · 19s cycle',
  dbeam_background_layer:           state?.dbeam_before_nodes === true,
  dbeam_after_vertical:             state?.dbeam_after_vbeam === true,
  all_three_beams_present:          state?.dbeam_present && state?.vbeam_present && state?.hbeam_present,
  coprime_trio_pairwise:            coprime_trio,
  r717_has_10_entries:              Array.isArray(patterns) && patterns.length === 10,
  r717_trio_entry_correct:          trioCorrect,
  r729_patterns_count_10:           stats?.patterns_count === 10,
  r729_ambient_patterns_2:          stats?.ambient_patterns === 2,
  r729_ambient_cadences_3:          stats?.ambient_cadences === 3,
  r732_a11y_has_9_entries:          Array.isArray(a11y) && a11y.length === 9,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R739 diagonal scan beam (3rd ambient member, completes scan-beam-trio with pairwise-coprime cadences):`,
  JSON.stringify(results, null, 2),
  `\n  trio entry: ${JSON.stringify(trioEntry)}`,
  `\n  gcd: 19-23=${gcd(19,23)} 19-30=${gcd(19,30)} 23-30=${gcd(23,30)}`);
process.exit(ok ? 0 : 1);
