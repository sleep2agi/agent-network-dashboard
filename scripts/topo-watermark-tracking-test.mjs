/* Round 289 verification: sleep2agi watermark wordmark gains
 * letterSpacing="0.5". Same typographic-intent idiom R285 (kicker
 * tracking-widest) and R286 (title tracking-tight) — letter-spacing
 * as deliberate register signal.
 *
 * Contract:
 *   - [data-topo-brand-watermark] computed letter-spacing ≈ 0.5px.
 *     (SVG letter-spacing attr value is parsed as user-space units;
 *     at fontSize 11 monospace, 0.5px reads as a noticeable but
 *     non-loud track widening.)
 *   - Text content still 'sleep2agi'.
 *   - opacity still 0.4 (watermark register preserved).
 *   - fontWeight still 600.
 *   - R287 minimap rect + R286 title + R285 kicker + R283 monogram
 *     stroke all intact (regression).
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
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const mark = document.querySelector('[data-topo-brand-watermark]');
  const ls = mark ? mark.getAttribute('letter-spacing') : null;
  const computedLs = mark ? getComputedStyle(mark).letterSpacing : null;
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const title  = document.querySelector('[data-topo-section-title]');
  const kCs = kicker ? getComputedStyle(kicker) : null;
  const tCs = title  ? getComputedStyle(title)  : null;
  const alphaNode = document.querySelector('g[data-node="alpha"]');
  const alphaCircles = alphaNode ? [...alphaNode.querySelectorAll('circle')] : [];
  const alphaAvatarCircle = alphaCircles
    .map(c => ({ r: +c.getAttribute('r') || 0, sw: c.getAttribute('stroke-width'), isBadge: c.hasAttribute('data-runtime-badge') }))
    .filter(c => c.r > 0 && c.r < 18 && !c.isBadge)
    .sort((a, b) => b.r - a.r)[0];
  return {
    present:           mark !== null,
    text:              mark?.textContent ?? null,
    opacity:           mark?.getAttribute('opacity') ?? null,
    fontWeight:        mark?.getAttribute('font-weight') ?? null,
    letterSpacingAttr: ls,
    computedLetterSpacing: computedLs,
    kickerLs:          kCs?.letterSpacing ?? null,
    titleLs:           tCs?.letterSpacing ?? null,
    alphaAvatarStroke: alphaAvatarCircle?.sw ?? null,
  };
});
await browser.close();

const computedLsVal = parseFloat(probe.computedLetterSpacing) || 0;
const kLs = parseFloat(probe.kickerLs) || 0;
const tLs = parseFloat(probe.titleLs) || 0;

const results = {
  watermark_present:           probe.present,
  watermark_text_kept:         probe.text === 'sleep2agi',
  watermark_letter_spacing_attr_set: probe.letterSpacingAttr === '0.5',
  watermark_computed_ls_about_half: computedLsVal >= 0.4 && computedLsVal <= 0.7,
  watermark_opacity_kept:      probe.opacity === '0.4',
  watermark_font_weight_kept:  probe.fontWeight === '600',
  r285_kicker_widest_kept:     kLs >= 1.0 && kLs <= 1.5,
  r286_title_tight_kept:       tLs < 0,
  r283_monogram_stroke_kept:   probe.alphaAvatarStroke === '1.5',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} watermark tracking:`, JSON.stringify(results),
  '\n  text:', JSON.stringify(probe.text),
  '\n  attr letter-spacing:', probe.letterSpacingAttr,
  '\n  computed letter-spacing:', probe.computedLetterSpacing,
  '\n  opacity:', probe.opacity);
process.exit(ok ? 0 : 1);
