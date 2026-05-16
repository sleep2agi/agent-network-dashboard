/* Round 363 verification: recent-signal row text fontWeight 400 → 500.
 * At fontSize=9 the default-weight text was thin; R363 lifts to the
 * font-medium tier (500) for better legibility against the panel
 * chrome. R320 count tspan fw 600/700 override stays local, so the
 * count-vs-alias hierarchy holds:
 *   alias  fw 500  (R363)
 *   count  fw 600/700  (R320)
 *
 * Contract:
 *   - data-recent-row-text element font-weight attr === '500'.
 *   - data-recent-row-text-font-weight === '500'.
 *   - The inner count tspan still has fw 600 (cold flow, R320 default).
 *   - Pre-R363 invariants:
 *     * fontSize=9 + fontFamily=monospace
 *     * R220 letter-spacing pin tween still wired (style.transition
 *       contains letter-spacing)
 *     * data-recent-row-text key surfaces the link key
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b') ] } });
});
const now = Date.now();
// 3 messages on the same link → count = 3 (cold, below the 10 hot threshold).
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
  { id: 'm2', from_alias: 'a', to_alias: 'b', content: 'pong',
    network_id: 'default', created_at: new Date(now - 4000).toISOString() },
  { id: 'm3', from_alias: 'a', to_alias: 'b', content: 'ping2',
    network_id: 'default', created_at: new Date(now - 3000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-row-text]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const t = document.querySelector('[data-recent-row-text]');
  const count = document.querySelector('[data-recent-row-count]');
  const cs = t ? getComputedStyle(t) : null;
  return {
    fontWeightAttr:  t?.getAttribute('font-weight') ?? null,
    fontWeightData:  t?.getAttribute('data-recent-row-text-font-weight') ?? null,
    fontSizeAttr:    t?.getAttribute('font-size') ?? null,
    fontFamily:      t?.getAttribute('font-family') ?? null,
    linkKey:         t?.getAttribute('data-recent-row-text') ?? null,
    transition:      cs?.transition ?? null,
    countFwAttr:     count?.getAttribute('font-weight') ?? null,  // R320 override
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  font_weight_500:       probe.fontWeightAttr === '500',
  data_fw_500:           probe.fontWeightData === '500',
  font_size_9:           probe.fontSizeAttr === '9',
  font_family_mono:      /monospace/i.test(probe.fontFamily || ''),
  link_key_present:      (probe.linkKey || '').length > 0,
  trans_has_letterspacing: hasTrans(probe.transition, 'letter-spacing'),  // R220
  count_fw_600:          probe.countFwAttr === '600',                      // R320 cold default
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row text fw 400 → 500:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
