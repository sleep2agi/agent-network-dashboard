/* Round 368 verification: recent-panel '+N more flows' footer text
 * fontWeight 400 → 500. Sibling small-text fw lift family with R363
 * recent-row alias + R364 legend-row label + R366 group-label count
 * — all four lifts thicken small-fontSize text (9-11 px) against
 * panel chrome from SVG-default 400 to the font-medium tier (500).
 *
 * The footer only renders when flowLinks.length > 3 (the panel shows
 * the 3 most recent + a footer link to /messages for the overflow).
 *
 * Contract (cyber, 5+ flow links so the footer mounts):
 *   - data-recent-panel-more text element font-weight === '500'.
 *   - data-recent-panel-more-font-weight === '500'.
 *   - Pre-R368 invariants on the same element:
 *     * fontSize='9' + fontFamily='monospace' + fontStyle='italic'
 *     * letter-spacing='0.2' (R325 rest baseline)
 *     * opacity='0.55' (rest, R325 era)
 *     * inline transition lists opacity + letter-spacing + fill
 *     * data-recent-panel-more attr surfaces the count
 *     * data-recent-panel-more-unit tspan with opacity 0.7 (R340)
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
    mk('a'), mk('b'), mk('c'), mk('d'), mk('e'),
  ] } });
});
// 5 distinct flow links → panel shows 3 + footer "+ 2 more flows".
const now = Date.now();
const pairs = [['a','b'], ['c','d'], ['a','c'], ['b','d'], ['e','a']];
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages:
  pairs.map(([from, to], idx) => ({
    id: `m${idx}`, from_alias: from, to_alias: to, content: `ping ${idx}`,
    network_id: 'default',
    created_at: new Date(now - (5000 + idx * 1000)).toISOString(),
  }))
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-more]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const t = document.querySelector('[data-recent-panel-more]');
  const unit = document.querySelector('[data-recent-panel-more-unit]');
  const cs = t ? getComputedStyle(t) : null;
  return {
    fontWeightAttr:  t?.getAttribute('font-weight') ?? null,
    fontWeightData:  t?.getAttribute('data-recent-panel-more-font-weight') ?? null,
    fontSizeAttr:    t?.getAttribute('font-size') ?? null,
    fontFamily:      t?.getAttribute('font-family') ?? null,
    fontStyle:       t?.getAttribute('font-style') ?? null,
    letterSpacing:   t?.getAttribute('letter-spacing') ?? null,
    opacityAttr:     t?.getAttribute('opacity') ?? null,
    moreCount:       t?.getAttribute('data-recent-panel-more') ?? null,
    hoveredAttr:     t?.getAttribute('data-recent-panel-more-hovered') ?? null,
    transition:      cs?.transition ?? null,
    unitOpacity:     unit?.getAttribute('opacity') ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  font_weight_500:        probe.fontWeightAttr === '500',
  data_fw_500:            probe.fontWeightData === '500',
  font_size_9:            probe.fontSizeAttr === '9',
  font_family_mono:       /monospace/i.test(probe.fontFamily || ''),
  font_style_italic:      probe.fontStyle === 'italic',     // pre-R368
  letter_spacing_0_2:     probe.letterSpacing === '0.2',    // R325 rest
  opacity_0_55_rest:      probe.opacityAttr === '0.55',     // R325 era rest
  more_count_2:           probe.moreCount === '2',          // 5 links - 3 shown
  hovered_false_rest:     probe.hoveredAttr === 'false',
  trans_has_letterspacing: hasTrans(probe.transition, 'letter-spacing'),
  trans_has_fill:         hasTrans(probe.transition, 'fill'),
  unit_opacity_0_7:       probe.unitOpacity === '0.7',      // R340 unit split
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} more-flows footer fw 400 → 500:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
