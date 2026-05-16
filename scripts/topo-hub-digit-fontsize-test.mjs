/* Round 360 verification: hub working-count digit fontSize 11 → 12.
 * The hub is the canvas's focal point — its digit is the most-read
 * scalar on the whole topology. R130 sized it at 11 inside the
 * r=10 / 20-px core; R360 nudges to 12 (~13 px wide × 12 px tall,
 * still well inside) for ~9 % more presence. Sibling visual-weight
 * bump family with R287/R295/R359.
 *
 * Contract:
 *   - Hub digit font-size attr === '12'.
 *   - data-topo-hub-working-count-font-size === '12'.
 *   - data-topo-hub-working-count surfaces the count (>0 with mocked
 *     working sessions).
 *   - Pre-R360 invariants: R225 tabular-nums + R209 scale-on-hover
 *     transform-box still set, fontWeight=700, dy="0.36em" preserved.
 *   - Overlap-test stays green (digit is inside hub <g>, not a node
 *     the overlap probe scans).
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
  // 3 working sessions → workingCount=3 → digit visible.
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub-working-count]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const t = document.querySelector('[data-topo-hub-working-count]');
  const cs = t ? getComputedStyle(t) : null;
  return {
    fontSizeAttr:    t?.getAttribute('font-size') ?? null,
    fontSizeData:    t?.getAttribute('data-topo-hub-working-count-font-size') ?? null,
    countValue:      t?.getAttribute('data-topo-hub-working-count') ?? null,
    fontWeight:      t?.getAttribute('font-weight') ?? null,
    dy:              t?.getAttribute('dy') ?? null,
    fontVariant:     cs?.fontVariantNumeric ?? null,
    transformBox:    cs?.transformBox ?? null,
    transformOrigin: cs?.transformOrigin ?? null,
    transition:      cs?.transition ?? null,
    opacity:         t?.getAttribute('opacity') ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  font_size_attr_12:    probe.fontSizeAttr === '12',
  data_font_size_12:    probe.fontSizeData === '12',
  count_value_3:        probe.countValue === '3',           // 3 mocked working sessions
  font_weight_700:      probe.fontWeight === '700',
  dy_0_36em:            probe.dy === '0.36em',
  tabular_nums:         /tabular-nums/.test(probe.fontVariant || ''),  // R225
  transform_box_fill:   probe.transformBox === 'fill-box',             // R209
  trans_has_transform:  hasTrans(probe.transition, 'transform'),       // R209
  trans_has_fill:       hasTrans(probe.transition, 'fill'),            // R253
  opacity_visible:      probe.opacity === '1',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub digit fontSize 11 → 12:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
