/* Round 285 verification: section kicker letter-spacing widens
 * tracking-wider (0.05em) → tracking-widest (0.1em).
 *
 * Tailwind v4 utility class compiles to:
 *   tracking-wider  → letter-spacing: 0.05em
 *   tracking-widest → letter-spacing: 0.1em
 *
 * At text-xs (12px) the 0.05em→0.1em jump adds ~0.6px between
 * letters, which on an uppercase 'NETWORK TOPOLOGY' label
 * telegraphs "eyebrow label" cleanly vs body-text density.
 *
 * Contract:
 *   - [data-topo-section-kicker] computed letter-spacing ~ 0.1em
 *     (12 * 0.1 = 1.2px ± rounding).
 *   - Pre-R285 was 0.05em → ~0.6px.
 *   - Element still text-transform: uppercase, font-size: 12px.
 *   - data-topo-section-title sibling unchanged (regression).
 *   - R283 monogram stroke + R282 watermark intact (regression).
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
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 15000 });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const title  = document.querySelector('[data-topo-section-title]');
  const kCs = kicker ? getComputedStyle(kicker) : null;
  const tCs = title  ? getComputedStyle(title)  : null;
  // Probe alpha avatar circle stroke for R283 regression.
  const alphaNode = document.querySelector('g[data-node="alpha"]');
  const alphaCircles = alphaNode ? [...alphaNode.querySelectorAll('circle')] : [];
  const alphaAvatarCircle = alphaCircles
    .map(c => ({ r: +c.getAttribute('r') || 0, sw: c.getAttribute('stroke-width'), isBadge: c.hasAttribute('data-runtime-badge') }))
    .filter(c => c.r > 0 && c.r < 18 && !c.isBadge)
    .sort((a, b) => b.r - a.r)[0];
  const watermark = document.querySelector('[data-topo-brand-watermark]');
  return {
    kickerLetterSpacing: kCs?.letterSpacing ?? null,
    kickerFontSize:      kCs?.fontSize ?? null,
    kickerTextTransform: kCs?.textTransform ?? null,
    kickerText:          kicker?.textContent ?? null,
    titleText:           title?.textContent ?? null,
    titleLeading:        tCs?.lineHeight ?? null,
    alphaAvatarStroke:   alphaAvatarCircle?.sw ?? null,
    watermarkPresent:    watermark !== null,
  };
});
await browser.close();

// 12px * 0.1em = 1.2px (post-R285). Pre-R285 0.05em = 0.6px.
// Allow tolerance window 1.0–1.4 to be safe across rounding.
const ls = parseFloat(probe.kickerLetterSpacing) || 0;
const fs = parseFloat(probe.kickerFontSize) || 12;
const lsPerEm = fs ? ls / fs : 0;

const results = {
  kicker_present:           probe.kickerText === 'Network Topology',
  kicker_uppercase:         probe.kickerTextTransform === 'uppercase',
  kicker_widest_ls:         ls >= 1.0 && ls <= 1.5,  // 0.1em at 12px ≈ 1.2px
  kicker_ls_per_em_widest:  lsPerEm >= 0.08 && lsPerEm <= 0.12,
  title_still_present:      probe.titleText === 'Command mesh',
  r283_monogram_stroke_kept: probe.alphaAvatarStroke === '1.5',
  r282_watermark_present:    probe.watermarkPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} kicker tracking:`, JSON.stringify(results),
  '\n  kicker text:', JSON.stringify(probe.kickerText),
  '\n  letter-spacing:', probe.kickerLetterSpacing, `(=${lsPerEm.toFixed(3)}em)`,
  '\n  font-size:', probe.kickerFontSize,
  '\n  title text:', JSON.stringify(probe.titleText));
process.exit(ok ? 0 : 1);
