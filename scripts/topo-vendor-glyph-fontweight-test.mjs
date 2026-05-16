/* Round 369 verification: vendor letter glyph fontWeight 600. Pre-
 * R369 the glyph inherited fw 500 from the chip's font-medium —
 * letter and `:N` count read at the same weight, contradicting the
 * data-vs-label hierarchy the rest of the chip-row speaks (R362).
 * R369 lifts the LETTER to fw 600 so the chip reads as the same
 * two-tier pattern:
 *   letter (data)  fw 600  (R369, this round)
 *   :N count       fw 500  (R333 + chip-level font-medium)
 *
 * Extends the R333-R341/R362 chip-internal-hierarchy arc to the
 * vendor-letter chip surface (9th surface family).
 *
 * Contract (cyber, fixture with 3 distinct vendors so the chip mounts):
 *   - Each rendered [data-vendor-letter-glyph] computed fontWeight === '600'.
 *   - data-vendor-letter-glyph-font-weight === '600'.
 *   - R354 transform-scale rest (matrix identity / 'none') preserved.
 *   - R354 transition list contains transform.
 *   - The sibling count suffix [data-vendor-letter-count-suffix]
 *     still has fontWeight inherited from chip's font-medium (500)
 *     — not bumped, so hierarchy is preserved.
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
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // R281 vendor-dist threshold > 2 — provide 3 distinct vendors.
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

const probe = await page.evaluate(() => {
  const glyphs = Array.from(document.querySelectorAll('[data-vendor-letter-glyph]'));
  return glyphs.map(el => {
    const cs = getComputedStyle(el);
    const chip = el.closest('[data-vendor-letter]');
    const suffix = chip?.querySelector('[data-vendor-letter-count-suffix]');
    const sCs = suffix ? getComputedStyle(suffix) : null;
    return {
      key:           el.getAttribute('data-vendor-letter-glyph'),
      fontWeight:    cs.fontWeight,
      fontWeightData: el.getAttribute('data-vendor-letter-glyph-font-weight'),
      transform:     cs.transform,
      transition:    cs.transition,
      suffixFw:      sCs?.fontWeight ?? null,
    };
  });
});

await browser.close();

const isRestTransform = (t) => t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t || '');
const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const allOk = probe.length >= 3 && probe.every(g =>
  g.fontWeight === '600'
  && g.fontWeightData === '600'
  && isRestTransform(g.transform)
  && hasTrans(g.transition, 'transform')
  && g.suffixFw === '500'  // chip-level font-medium inheritance
);

const results = {
  glyphs_rendered_3plus:   probe.length >= 3,
  all_glyphs_fw_600:       probe.every(g => g.fontWeight === '600'),
  all_glyphs_data_600:     probe.every(g => g.fontWeightData === '600'),
  all_glyphs_rest_xform:   probe.every(g => isRestTransform(g.transform)),
  all_glyphs_trans_xform:  probe.every(g => hasTrans(g.transition, 'transform')),
  all_suffixes_fw_500:     probe.every(g => g.suffixFw === '500'),
};
const ok = allOk && Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor letter glyph fw 500 → 600:`, JSON.stringify(results),
  '\n  glyphs:', probe.map(g => ({ key: g.key, fw: g.fontWeight, suffixFw: g.suffixFw })));
process.exit(ok ? 0 : 1);
