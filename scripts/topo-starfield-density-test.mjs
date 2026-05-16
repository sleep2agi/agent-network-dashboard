/* Round 291 verification: starfield decorative dot count 28 → 14
 * (50% reduction). Continuation of the 减法 register R290 pivoted
 * back to. Atmospheric depth preserved; visual density cut in
 * half so the eye has less ambient decoration to skip past.
 *
 * Contract:
 *   - [data-topo-starfield] container exists (cyber only).
 *   - 14 [data-topo-starfield-dot] children (was 28).
 *   - opacity 0.5 on the container unchanged (regression).
 *   - Light theme: starfield NOT rendered (regression — pre-R291
 *     behaviour, conditional on !isLight).
 *   - R290 radar ring set still ['170','250','330'] (regression).
 *   - R289 watermark letterSpacing + R283 monogram stroke intact.
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
await page.waitForSelector('[data-topo-starfield]', { timeout: 15000 });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const sf = document.querySelector('[data-topo-starfield]');
  const dots = document.querySelectorAll('[data-topo-starfield-dot]');
  const opacity = sf?.getAttribute('opacity') ?? null;
  const rings = [...document.querySelectorAll('[data-topo-radar-ring]')]
    .map(r => r.getAttribute('data-topo-radar-ring')).sort((a, b) => +a - +b);
  const wm = document.querySelector('[data-topo-brand-watermark]');
  const wmLs = wm ? getComputedStyle(wm).letterSpacing : null;
  const alphaNode = document.querySelector('g[data-node="alpha"]');
  const alphaCircles = alphaNode ? [...alphaNode.querySelectorAll('circle')] : [];
  const alphaAvatarCircle = alphaCircles
    .map(c => ({ r: +c.getAttribute('r') || 0, sw: c.getAttribute('stroke-width'), isBadge: c.hasAttribute('data-runtime-badge') }))
    .filter(c => c.r > 0 && c.r < 18 && !c.isBadge)
    .sort((a, b) => b.r - a.r)[0];
  return {
    starfieldPresent: sf !== null,
    dotCount:         dots.length,
    opacity,
    radarRings:       rings,
    watermarkLs:      wmLs,
    alphaAvatarStroke: alphaAvatarCircle?.sw ?? null,
  };
});
await browser.close();

const wmLsVal = parseFloat(probe.watermarkLs) || 0;

const results = {
  starfield_container_present: probe.starfieldPresent,
  fourteen_dots:               probe.dotCount === 14,
  opacity_0_5_kept:            probe.opacity === '0.5',
  r290_three_rings:            JSON.stringify(probe.radarRings) === JSON.stringify(['170', '250', '330']),
  r289_watermark_ls_kept:      wmLsVal >= 0.4 && wmLsVal <= 0.7,
  r283_monogram_stroke_kept:   probe.alphaAvatarStroke === '1.5',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} starfield density:`, JSON.stringify(results),
  '\n  dot count (expect 14):', probe.dotCount,
  '\n  opacity:', probe.opacity,
  '\n  radar rings (R290):', probe.radarRings);
process.exit(ok ? 0 : 1);
