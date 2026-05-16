/* Round 340 verification: +N more flows footer extends the
 * R333/R335/R336/R337/R338 chip-internal-hierarchy arc to a 6th
 * surface. ` more flow(s)` unit demotes to opacity-0.7 inside a
 * nested tspan, while the `{moreCount}` digit stays prominent.
 *
 * Recurring pattern: small label spans demote, value stays prominent.
 *
 * Contract:
 *   - [data-recent-panel-more-unit] present with opacity="0.7"
 *     (rendered when flowLinks.length > 3 so the footer mounts).
 *   - textContent of the unit tspan contains 'more flow'.
 *   - Parent [data-recent-panel-more] .textContent retains
 *     "+ N more flow(s)" string.
 *   - R325 footer letterSpacing=0.2 + R259 fontSize=9 regressions.
 *   - R317/R318/R294 chrome + pulse regressions intact.
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
// 5 flow pairs — recent-signal panel renders top 3 + "+ 2 more flows"
const now = Date.now();
const mkMsg = (idx, from_alias, to_alias) => ({
  id: `${from_alias}-${to_alias}-${idx}`,
  from_alias, to_alias, content: `m${idx}`,
  network_id: 'default',
  created_at: new Date(now - (5 + idx) * 1000).toISOString(),
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
await page.waitForSelector('[data-recent-panel-more-unit]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const unit   = document.querySelector('[data-recent-panel-more-unit]');
  const parent = document.querySelector('[data-recent-panel-more]');
  return {
    unitAttr:        unit?.getAttribute('opacity') ?? null,
    unitText:        unit?.textContent ?? null,
    parentText:      parent?.textContent ?? null,
    parentFontSize:  parent?.getAttribute('font-size') ?? null,
    parentLetterSp:  parent?.getAttribute('letter-spacing') ?? null,
    layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  unit_opacity_attr_0_7:    probe.unitAttr === '0.7',
  unit_text_more_flow:      (probe.unitText || '').includes('more flow'),
  parent_text_pattern:      /\+\s*\d+\s+more\s+flow/i.test(probe.parentText || ''),
  // R325 + R259 regression.
  r325_footer_letter_sp:    probe.parentLetterSp === '0.2',
  r259_footer_font_size_9:  probe.parentFontSize === '9',
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:   probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:  probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:        probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} more-flows footer unit:`, JSON.stringify(results),
  '\n  unit text:',   JSON.stringify(probe.unitText),    'opacity:', probe.unitAttr,
  '\n  parent text:', JSON.stringify(probe.parentText));
process.exit(ok ? 0 : 1);
