/* Round 325 verification: "+N more flows" footer link picks up
 * letterSpacing="0.2" — joins the R285/R289/R301/R302/R304
 * editorial-letterspacing family.
 *
 * The footer is the recent-signal panel's primary navigation
 * affordance into /messages (R128/R133). It carries designed-
 * label semantics ("action label", not row data) but pre-R325
 * sat orphaned from the editorial-spacing axis even though its
 * siblings — kicker/watermark/panel titles/empty hint — all had
 * intentional letter-spacing.
 *
 * 6-axis editorial-letterspacing hierarchy after this round:
 *   R285 kicker:        1.2px (eyebrow loud)
 *   R289 watermark:     0.5px (wordmark brand)
 *   R301 panel titles:  0.3px (section headers)
 *   R302 empty main:    0.2px (empty-state hint)
 *   R325 footer link:   0.2px (panel nav action) ← this round
 *   R304 empty sub:     0.15px (instructional sub)
 *
 * Contract:
 *   - [data-recent-panel-more] is present (requires > 3 flowLinks
 *     so the footer mounts visible — fixture: 5 message pairs to
 *     produce 5 flows).
 *   - The element's `letter-spacing` SVG attribute === '0.2' (the
 *     literal authored value; computed style normalizes).
 *   - R195 cyan-hover regression: [data-recent-panel-more-hovered]
 *     defaults to 'false' (no hover simulated).
 *   - R259 fontSize regression: fontSize="9" preserved.
 *   - R317 / R318 / R294 chrome + pulse regressions intact.
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
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'), mk('epsilon'),
  ] } });
});
// 5 distinct flow pairs — recent-signal panel renders top 3 + "+ 2 more flows".
const now = Date.now();
const mkMsg = (i, from_alias, to_alias) => ({
  id: `${from_alias}-${to_alias}-${i}`,
  from_alias, to_alias, content: `m${i}`,
  network_id: 'default',
  created_at: new Date(now - (5 + i) * 1000).toISOString(),
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  mkMsg(1, 'alpha', 'beta'),
  mkMsg(2, 'beta',  'gamma'),
  mkMsg(3, 'gamma', 'delta'),
  mkMsg(4, 'delta', 'epsilon'),
  mkMsg(5, 'epsilon', 'alpha'),
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-more]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const more = document.querySelector('[data-recent-panel-more]');
  return {
    text:           more?.textContent ?? null,
    moreCountAttr:  more?.getAttribute('data-recent-panel-more') ?? null,
    hoveredAttr:    more?.getAttribute('data-recent-panel-more-hovered') ?? null,
    letterSpacing:  more?.getAttribute('letter-spacing') ?? null,
    fontSize:       more?.getAttribute('font-size') ?? null,
    fontStyle:      more?.getAttribute('font-style') ?? null,
    layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  more_link_present:           probe.text !== null,
  more_text_pattern:           /\+\s*\d+\s+more\s+flow/i.test(probe.text || ''),
  more_letter_spacing_0_2:     probe.letterSpacing === '0.2',
  // R259 regression — fontSize 9.
  r259_font_size_9:            probe.fontSize === '9',
  more_italic:                 probe.fontStyle === 'italic',
  // R195 regression — default not-hovered state.
  r195_default_not_hovered:    probe.hoveredAttr === 'false',
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:      probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} more-flows letterSpacing:`, JSON.stringify(results),
  '\n  text:', JSON.stringify(probe.text),
  '\n  letter-spacing:', probe.letterSpacing);
process.exit(ok ? 0 : 1);
