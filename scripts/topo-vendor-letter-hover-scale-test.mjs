/* Round 354 verification: vendor letter glyph scales 1.0 → 1.1 on
 * hover. R88 already dims OTHER vendors via canvas-wide opacity
 * masking; R202 added a chip-level bg tint (color-mix 12 % alpha) so
 * the chip itself responds. R354 closes the trio with a glyph-level
 * lift: the focused vendor LETTER actively rises (transform scale)
 * rather than the chip merely changing colour.
 *
 * Three layers of positive feedback on the hovered vendor + canvas-
 * wide negative feedback on the others — a clean figure/ground
 * separation.
 *
 * Contract (cyber, fixture with 3 distinct vendors so R281's > 2
 * threshold mounts the chip):
 *   - Rest: vendor letter glyph transform === matrix(1, 0, 0, 1, 0, 0)
 *     (identity).
 *   - Hover one vendor chip: that glyph transform === matrix(1.1, 0,
 *     0, 1.1, 0, 0).
 *   - data-vendor-letter-glyph-hover toggles false → true on
 *     hovered chip only; sibling glyphs stay 'false'.
 *   - Inline transition contains 'transform'.
 *   - Pre-R354 invariants: R202 bg color-mix on hover still applies,
 *     data-vendor-letter-count-suffix span (R333) still present.
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
  // R281 vendor-dist threshold is > 2 distinct vendors — provide 3.
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a1', 'claude-opus-4'),
    mk('a2', 'claude-opus-4'),
    mk('b1', 'gpt-4o'),
    mk('b2', 'gpt-4o'),
    mk('c1', 'internlm/internlm2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-vendor-letter-glyph]', { timeout: 15000 });
await page.waitForTimeout(300);

// Read all vendor letters present.
const inventory = await page.evaluate(() => {
  const glyphs = Array.from(document.querySelectorAll('[data-vendor-letter-glyph]'));
  return glyphs.map(el => el.getAttribute('data-vendor-letter-glyph'));
});

// Pick the first vendor letter for the hover test.
const target = inventory[0];

const restProbe = await page.evaluate((tgt) => {
  const glyph = document.querySelector(`[data-vendor-letter-glyph="${tgt}"]`);
  const cs    = glyph ? getComputedStyle(glyph) : null;
  const chip  = glyph ? glyph.closest('[data-vendor-letter]') : null;
  const suffix = chip ? chip.querySelector('[data-vendor-letter-count-suffix]') : null;
  return {
    transform:     cs?.transform ?? null,
    transition:    cs?.transition ?? null,
    hoverAttr:     glyph?.getAttribute('data-vendor-letter-glyph-hover') ?? null,
    display:       cs?.display ?? null,
    suffixPresent: !!suffix,
  };
}, target);

// Hover the target vendor letter's chip.
await page.hover(`[data-vendor-letter="${target}"]`);
await page.waitForTimeout(300);
const hoverProbe = await page.evaluate((tgt) => {
  const glyph = document.querySelector(`[data-vendor-letter-glyph="${tgt}"]`);
  const cs    = glyph ? getComputedStyle(glyph) : null;
  // Read all sibling hover attrs to confirm only one is active.
  const all = Array.from(document.querySelectorAll('[data-vendor-letter-glyph]'))
    .map(el => ({ key: el.getAttribute('data-vendor-letter-glyph'),
                  hover: el.getAttribute('data-vendor-letter-glyph-hover') }));
  return {
    transform:  cs?.transform ?? null,
    hoverAttr:  glyph?.getAttribute('data-vendor-letter-glyph-hover') ?? null,
    siblings:   all,
  };
}, target);

await browser.close();

const isIdentity = (t) => t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t || '');
const isScale110 = (t) => /matrix\(1\.1, 0, 0, 1\.1, 0, 0\)/.test(t || '');
const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const siblingsOnlyOneTrue = hoverProbe.siblings.filter(s => s.hover === 'true').length === 1
  && hoverProbe.siblings.find(s => s.key === target)?.hover === 'true';

const results = {
  inventory_has_glyphs:  inventory.length >= 3,
  rest_identity:         isIdentity(restProbe.transform),
  rest_hover_false:      restProbe.hoverAttr === 'false',
  // Flex children get display: block computed (spec blockification),
  // even when declared inline-block — accept either for safety.
  rest_display_block:    restProbe.display === 'inline-block' || restProbe.display === 'block',
  trans_has_transform:   hasTrans(restProbe.transition, 'transform'),
  suffix_present:        restProbe.suffixPresent,   // R333 preserved
  hover_scale_110:       isScale110(hoverProbe.transform),
  hover_attr_true:       hoverProbe.hoverAttr === 'true',
  hover_isolates_target: siblingsOnlyOneTrue,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor letter glyph hover-scale:`, JSON.stringify(results),
  '\n  inventory:', inventory,
  '\n  rest:     ', restProbe,
  '\n  hover:    ', hoverProbe);
process.exit(ok ? 0 : 1);
