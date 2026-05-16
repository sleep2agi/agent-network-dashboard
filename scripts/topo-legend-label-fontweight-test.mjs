/* Round 364 verification: legend-row label fontWeight 400 → 500.
 * Sibling typography lift to R363 recent-row text fw 400 → 500.
 * Both surfaces render small monospace text against panel chrome
 * at fontSize 9-11 where SVG-default fw 400 sits at the legibility
 * floor.
 *
 * Family snapshot post-R364:
 *   legend  label  fw 500  (R364, this round)
 *   legend  count  fw 600  (R309)
 *   recent  alias  fw 500  (R363)
 *   recent  count  fw 600/700  (R320)
 *
 * Contract (cyber, fixture with active rows):
 *   - Each rendered [data-legend-row-label] has font-weight === '500'.
 *   - Each has data-legend-row-label-font-weight === '500'.
 *   - Pre-R364 invariants:
 *     * fontSize=11 + fontFamily=monospace
 *     * R219 letter-spacing 0 → 0.5px on pin (style.transition still
 *       lists letter-spacing)
 *     * R55 fill transition retained
 *     * data-legend-row-label key surfaces (working / idle / offline)
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-legend-row-label]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('[data-legend-row-label]'));
  return labels.map(el => {
    const cs = getComputedStyle(el);
    return {
      key:           el.getAttribute('data-legend-row-label'),
      fontWeightAttr: el.getAttribute('font-weight'),
      fontWeightData: el.getAttribute('data-legend-row-label-font-weight'),
      fontSizeAttr:   el.getAttribute('font-size'),
      fontFamily:     el.getAttribute('font-family'),
      transition:     cs.transition,
    };
  });
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const allRowsOk = probe.length > 0 && probe.every(r =>
  r.fontWeightAttr === '500'
  && r.fontWeightData === '500'
  && r.fontSizeAttr === '11'
  && /monospace/i.test(r.fontFamily || '')
  && hasTrans(r.transition, 'letter-spacing')
  && hasTrans(r.transition, 'fill')
);

const results = {
  rows_rendered:        probe.length >= 1,
  all_rows_fw_500:      probe.every(r => r.fontWeightAttr === '500'),
  all_rows_data_500:    probe.every(r => r.fontWeightData === '500'),
  all_rows_fontsize_11: probe.every(r => r.fontSizeAttr === '11'),
  all_rows_monospace:   probe.every(r => /monospace/i.test(r.fontFamily || '')),
  all_rows_have_ls_trans: probe.every(r => hasTrans(r.transition, 'letter-spacing')),
  all_rows_have_fill_trans: probe.every(r => hasTrans(r.transition, 'fill')),
};
const ok = allRowsOk && Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend-row label fw 400 → 500:`, JSON.stringify(results),
  '\n  rows: ', probe.map(r => ({ key: r.key, fw: r.fontWeightAttr })));
process.exit(ok ? 0 : 1);
