/* Round 373 verification: pressure-bar kicker label fontWeight 400 →
 * 500. Sibling small-text fw lift family with R363/R364/R366/R368 —
 * 5th surface in the family.
 *
 * Family snapshot post-R373:
 *   recent-row alias          fw 500  (R363)
 *   legend-row label          fw 500  (R364)
 *   group-label count         fw 500  (R366)
 *   +N more flows footer      fw 500  (R368)
 *   pressure-bar kicker       fw 500  (R373, this round)
 *
 * Contract (cyber, fixture with mix so pressure bar renders):
 *   - [data-fleet-pressure-kicker] computed fontWeight === '500'.
 *   - Pre-R373 invariants:
 *     * text-[10px] (fontSize 10) preserved
 *     * tracking-wide (letter-spacing 0.025em) preserved
 *     * Parent [data-fleet-pressure] still has font-mono + chip
 *       structure
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
await page.waitForSelector('[data-fleet-pressure-kicker]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const kicker = document.querySelector('[data-fleet-pressure-kicker]');
  const parent = document.querySelector('[data-fleet-pressure]');
  const cs = kicker ? getComputedStyle(kicker) : null;
  return {
    fontWeight:   cs?.fontWeight ?? null,
    fontSize:     cs?.fontSize ?? null,
    letterSpacing: cs?.letterSpacing ?? null,
    text:         kicker?.textContent ?? null,
    parentCls:    parent?.getAttribute('class') ?? null,
  };
});

await browser.close();

const results = {
  font_weight_500:        probe.fontWeight === '500',
  font_size_10px:         probe.fontSize === '10px',
  // tracking-wide = 0.025em → at 10px font that's 0.25px computed.
  letter_spacing_tracking_wide: /0\.25px|0\.025em/.test(probe.letterSpacing || ''),
  text_is_pressure:       probe.text === 'pressure',
  parent_font_mono:       /font-mono/.test(probe.parentCls || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pressure-bar kicker fw 400 → 500:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
