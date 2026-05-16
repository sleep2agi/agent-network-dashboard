/* Round 401 verification: vendor letter chips close the hover-lift
 * gesture family at the last interactive HTML chip surface. Sibling
 * to R397 filter pin pills + R398/R399 chip-row chips + R400 chrome
 * standalone buttons.
 *
 * Contract:
 *   - Vendor letter chip mounted with at least one vendor present:
 *     * data-vendor-letter-hover-lift === 'true'
 *     * className includes 'hover:-translate-y-px'
 *     * className includes 'transition-transform' + 'transform-gpu'
 *   - Pre-R401 invariants preserved:
 *     * tabular-nums + font-medium + anet-topo-chip-focus
 *     * data-vendor-letter / -count / -pinned / -hovered attrs present
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, model) => ({
    alias, status: 'idle', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-5'),
    mk('gamma', 'gemini-2.0-pro'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-vendor-letter-hover-lift="true"]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('[data-vendor-letter-hover-lift="true"]'));
  if (chips.length === 0) return null;
  return {
    count: chips.length,
    sample: {
      className:   chips[0].className,
      letter:      chips[0].getAttribute('data-vendor-letter'),
      vendorCount: chips[0].getAttribute('data-vendor-letter-count'),
      lift:        chips[0].getAttribute('data-vendor-letter-hover-lift'),
      pinned:      chips[0].getAttribute('data-vendor-pinned'),
    },
  };
});

await browser.close();

const cls = probe?.sample?.className || '';
const results = {
  // At least one vendor chip rendered (3 vendors in fixture)
  chips_count_ge_1:             (probe?.count || 0) >= 1,
  // R401 lift attrs + className tokens
  lift_true:                    probe?.sample?.lift === 'true',
  has_hover_translate:          cls.includes('hover:-translate-y-px'),
  has_transition_transform:     cls.includes('transition-transform'),
  has_transform_gpu:            cls.includes('transform-gpu'),
  // Pre-R401 invariants (R314 + R232 + R266)
  has_tabular_nums:             cls.includes('tabular-nums'),
  has_font_medium:              cls.includes('font-medium'),
  has_chip_focus:               cls.includes('anet-topo-chip-focus'),
  has_inline_flex:              cls.includes('inline-flex'),
  has_letter_attr:              !!probe?.sample?.letter,
  has_count_attr:               !!probe?.sample?.vendorCount,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor letter chip hover lift translateY(-1px):`, JSON.stringify(results),
  '\n  chips:', probe?.count, '/ sample:', JSON.stringify(probe?.sample, null, 2));
process.exit(ok ? 0 : 1);
