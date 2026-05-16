/* Round 284 verification: known-vendor monogram letter fontFamily
 * swaps monospace → system sans-serif. Continuation of R283 Vincent
 * 5216 vendor avatar polish arc.
 *
 * Contract:
 *   - Known vendor (Anthropic, OpenAI, …) monogram letter — rendered
 *     fontFamily resolves into a sans-serif stack (NOT monospace).
 *     The actual computed font-family will likely return the OS-
 *     preferred match such as -apple-system / Segoe UI / Inter / etc.
 *     (We assert it does NOT include 'monospace' as the active stack.)
 *   - data-monogram-letter attribute present on the <text> element
 *     with the vendor.initial as its value.
 *   - Prefix-group fallback (unknown vendor) keeps monospace — the
 *     R283 contrast pattern: designed glyph = known, code text =
 *     unknown.
 *   - R283 monogram stroke=1.5 still in place (regression).
 *   - R282 watermark still present (regression).
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),    // Anthropic → monogram (sans-serif)
    mk('beta',  'gpt-4o'),            // OpenAI → monogram (sans-serif)
    mk('gamma', null),                 // unknown → prefix-group (monospace)
    mk('delta', null),                 // unknown
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-monogram-letter]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  // All monogram letters carry data-monogram-letter; expect 2 (alpha + beta).
  const monos = [...document.querySelectorAll('[data-monogram-letter]')];
  const monoSamples = monos.map((t) => ({
    letter:    t.getAttribute('data-monogram-letter'),
    family:    getComputedStyle(t).fontFamily,
    weight:    getComputedStyle(t).fontWeight,
    parentAlias: t.closest('g[data-node]')?.getAttribute('data-node') ?? null,
  }));
  // Find prefix-group fallback text — inside g[data-node='gamma'], the
  // <text> WITHOUT data-monogram-letter attribute (the prefix-group one).
  const gammaNode = document.querySelector('g[data-node="gamma"]');
  const gammaTexts = gammaNode ? [...gammaNode.querySelectorAll('text')] : [];
  // The avatar text is the one inside the avatar IIFE — look for the
  // text whose font-size matches avatar radius (~10-14) and is centered
  // on the node. Easiest heuristic: text-anchor=middle, no data-monogram
  // attr (so it's the unknown-vendor branch).
  const prefixText = gammaTexts.find((t) =>
    t.getAttribute('text-anchor') === 'middle' &&
    !t.hasAttribute('data-monogram-letter')
  );
  const prefixFamily = prefixText ? getComputedStyle(prefixText).fontFamily : null;
  // Also probe alpha monogram circle stroke (R283 regression).
  const alphaNode = document.querySelector('g[data-node="alpha"]');
  const alphaCircles = alphaNode ? [...alphaNode.querySelectorAll('circle')] : [];
  const alphaAvatarCircle = alphaCircles
    .map(c => ({ r: +c.getAttribute('r') || 0, sw: c.getAttribute('stroke-width'), isBadge: c.hasAttribute('data-runtime-badge') }))
    .filter(c => c.r > 0 && c.r < 18 && !c.isBadge)
    .sort((a, b) => b.r - a.r)[0];
  const watermark = document.querySelector('[data-topo-brand-watermark]');
  return {
    monoSamples,
    prefixFamily,
    alphaAvatarStroke: alphaAvatarCircle?.sw ?? null,
    watermarkPresent: watermark !== null,
  };
});
await browser.close();

const isMonospace = (s) => /(^|,)\s*monospace\s*(,|$)|"monospace"/i.test(s || '');
const isSansSerif = (s) => /(sans-serif|system|Inter|Segoe|Helvetica|Arial|-apple-system|BlinkMac)/i.test(s || '');

const results = {
  two_monograms:                   probe.monoSamples.length === 2,
  alpha_letter_A:                  probe.monoSamples.some(s => s.parentAlias === 'alpha' && s.letter === 'A'),
  beta_letter_O:                   probe.monoSamples.some(s => s.parentAlias === 'beta'  && s.letter === 'O'),
  all_monos_sans_serif:            probe.monoSamples.every(s => isSansSerif(s.family) && !isMonospace(s.family)),
  prefix_group_keeps_monospace:    isMonospace(probe.prefixFamily),
  r283_monogram_stroke_1_5_kept:   probe.alphaAvatarStroke === '1.5',
  r282_watermark_present:          probe.watermarkPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} monogram font swap:`, JSON.stringify(results),
  '\n  alpha mono family:', probe.monoSamples.find(s => s.parentAlias === 'alpha')?.family,
  '\n  beta  mono family:', probe.monoSamples.find(s => s.parentAlias === 'beta')?.family,
  '\n  gamma prefix family:', probe.prefixFamily,
  '\n  alpha avatar circle stroke (R283):', probe.alphaAvatarStroke);
process.exit(ok ? 0 : 1);
