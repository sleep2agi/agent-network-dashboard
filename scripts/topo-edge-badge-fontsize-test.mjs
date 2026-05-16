/* Round 361 verification: edge midpoint badge text fontSize 10 → 11.
 * Sibling visual-weight bump to R360 hub digit 11 → 12. The badge
 * digit is the per-edge equivalent of the hub digit — a high-info
 * scalar (link.count) at a stable canvas position. Pre-R361 the
 * digit at fontSize=10 was readable but small against the r=9 /
 * 18-px badge envelope; fontSize=11 nudges the glyph ~10 % bigger
 * (bbox ~7×10 px from ~6×9 px). Still well inside the r=9 idle +
 * r=10.5 hover/pin (R164) envelope.
 *
 * Contract:
 *   - Edge badge text font-size attr === '11'.
 *   - data-edge-badge-text-font-size === '11'.
 *   - Pre-R361 invariants preserved:
 *     * R224 tabular-nums fontVariantNumeric
 *     * R220 letter-spacing 0px → 0.4px on pin/hot
 *     * fontWeight=700 + fontFamily=monospace
 *     * textAnchor="middle"
 *     * data-edge-badge-text={link.key} surface attr
 *
 * Test mounts the dashboard with 1 message → 1 flow link → 1 badge.
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-badge-text]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const t = document.querySelector('[data-edge-badge-text]');
  const cs = t ? getComputedStyle(t) : null;
  return {
    fontSizeAttr:    t?.getAttribute('font-size') ?? null,
    fontSizeData:    t?.getAttribute('data-edge-badge-text-font-size') ?? null,
    fontWeight:      t?.getAttribute('font-weight') ?? null,
    fontFamily:      t?.getAttribute('font-family') ?? null,
    textAnchor:      t?.getAttribute('text-anchor') ?? null,
    linkKey:         t?.getAttribute('data-edge-badge-text') ?? null,
    pinAttr:         t?.getAttribute('data-edge-badge-text-pin') ?? null,
    fontVariant:     cs?.fontVariantNumeric ?? null,
    letterSpacing:   cs?.letterSpacing ?? null,
  };
});

await browser.close();

const isRestLs = (v) => v === 'normal' || v === '0px' || v === '0' || v === null;

const results = {
  font_size_attr_11:    probe.fontSizeAttr === '11',
  data_font_size_11:    probe.fontSizeData === '11',
  font_weight_700:      probe.fontWeight === '700',
  font_family_mono:     /monospace/i.test(probe.fontFamily || ''),
  text_anchor_middle:   probe.textAnchor === 'middle',
  link_key_present:     (probe.linkKey || '').length > 0,
  pin_attr_false:       probe.pinAttr === 'false',     // single-flow, not isHot
  tabular_nums:         /tabular-nums/.test(probe.fontVariant || ''),  // R224
  rest_letter_spacing:  isRestLs(probe.letterSpacing),                  // R220 rest = 0
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge badge fontSize 10 → 11:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
