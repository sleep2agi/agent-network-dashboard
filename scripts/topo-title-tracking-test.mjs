/* Round 286 verification: h2 title 'Command mesh' adopts tracking-
 * tight (-0.025em) to pair with R285 kicker tracking-widest (0.1em).
 * Wide eyebrow + tight headline is the editorial-pairing convention.
 *
 * At text-lg = 18px, tracking-tight resolves to:
 *   18 * -0.025 = -0.45px letter-spacing
 *
 * Contract:
 *   - [data-topo-section-title] computed letter-spacing is negative
 *     and ~ -0.025em (= ~ -0.45px at 18px).
 *   - Text content still 'Command mesh'.
 *   - font-weight still 600 (font-semibold).
 *   - Kicker still tracking-widest (R285 regression).
 *   - R283 monogram stroke / R282 watermark intact.
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
await page.waitForSelector('[data-topo-section-title]', { timeout: 15000 });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const title  = document.querySelector('[data-topo-section-title]');
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const tCs = title  ? getComputedStyle(title)  : null;
  const kCs = kicker ? getComputedStyle(kicker) : null;
  const alphaNode = document.querySelector('g[data-node="alpha"]');
  const alphaCircles = alphaNode ? [...alphaNode.querySelectorAll('circle')] : [];
  const alphaAvatarCircle = alphaCircles
    .map(c => ({ r: +c.getAttribute('r') || 0, sw: c.getAttribute('stroke-width'), isBadge: c.hasAttribute('data-runtime-badge') }))
    .filter(c => c.r > 0 && c.r < 18 && !c.isBadge)
    .sort((a, b) => b.r - a.r)[0];
  const watermark = document.querySelector('[data-topo-brand-watermark]');
  return {
    titleLetterSpacing: tCs?.letterSpacing ?? null,
    titleFontSize:      tCs?.fontSize ?? null,
    titleFontWeight:    tCs?.fontWeight ?? null,
    titleText:          title?.textContent ?? null,
    kickerLetterSpacing: kCs?.letterSpacing ?? null,
    kickerFontSize:      kCs?.fontSize ?? null,
    alphaAvatarStroke:   alphaAvatarCircle?.sw ?? null,
    watermarkPresent:    watermark !== null,
  };
});
await browser.close();

const tLs = parseFloat(probe.titleLetterSpacing) || 0;
const tFs = parseFloat(probe.titleFontSize) || 18;
const tLsPerEm = tFs ? tLs / tFs : 0;

const kLs = parseFloat(probe.kickerLetterSpacing) || 0;
const kFs = parseFloat(probe.kickerFontSize) || 12;
const kLsPerEm = kFs ? kLs / kFs : 0;

const results = {
  title_present:                probe.titleText === 'Command mesh',
  title_tight_negative_ls:      tLs < 0,
  title_tight_about_n025em:     tLsPerEm <= -0.02 && tLsPerEm >= -0.03,
  title_font_weight_600:        String(probe.titleFontWeight) === '600',
  kicker_still_widest_r285:     kLsPerEm >= 0.08 && kLsPerEm <= 0.12,
  r283_monogram_stroke_kept:    probe.alphaAvatarStroke === '1.5',
  r282_watermark_present:       probe.watermarkPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} title tracking:`, JSON.stringify(results),
  '\n  title text:', JSON.stringify(probe.titleText),
  '\n  title letter-spacing:', probe.titleLetterSpacing, `(=${tLsPerEm.toFixed(4)}em)`,
  '\n  title font-size:', probe.titleFontSize, '  weight:', probe.titleFontWeight,
  '\n  kicker letter-spacing (R285):', probe.kickerLetterSpacing, `(=${kLsPerEm.toFixed(3)}em)`);
process.exit(ok ? 0 : 1);
