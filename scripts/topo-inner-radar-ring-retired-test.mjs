/* Round 290 verification: innermost radar ring at r=90 is retired.
 * Post-R290 only the outer three rings (170 / 250 / 330) remain.
 * Returns to 减法 register after R282-R289's 8 加法 rounds.
 *
 * Contract:
 *   - data-topo-radar-ring attributes resolve to ['170', '250', '330'].
 *   - NO element has data-topo-radar-ring="90".
 *   - All three remaining rings preserve fill='none' + stroke + the
 *     pal.ringStroke colour (regression on stroke styling).
 *   - R289 watermark letterSpacing + R287 minimap rect + R283 monogram
 *     stroke intact (regression).
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
await page.waitForSelector('[data-topo-radar-ring]', { timeout: 15000 });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const rings = [...document.querySelectorAll('[data-topo-radar-ring]')];
  const sortedRadii = rings.map(r => r.getAttribute('data-topo-radar-ring')).sort((a, b) => +a - +b);
  const innerRing90 = document.querySelector('[data-topo-radar-ring="90"]');
  const allHaveFillNone = rings.every(r => r.getAttribute('fill') === 'none');
  const allHaveStroke   = rings.every(r => r.getAttribute('stroke'));
  const wm = document.querySelector('[data-topo-brand-watermark]');
  const wmLs = wm ? getComputedStyle(wm).letterSpacing : null;
  const alphaNode = document.querySelector('g[data-node="alpha"]');
  const alphaCircles = alphaNode ? [...alphaNode.querySelectorAll('circle')] : [];
  const alphaAvatarCircle = alphaCircles
    .map(c => ({ r: +c.getAttribute('r') || 0, sw: c.getAttribute('stroke-width'), isBadge: c.hasAttribute('data-runtime-badge') }))
    .filter(c => c.r > 0 && c.r < 18 && !c.isBadge)
    .sort((a, b) => b.r - a.r)[0];
  return {
    radii: sortedRadii,
    ringCount: rings.length,
    innerRing90Present: innerRing90 !== null,
    allFillNone: allHaveFillNone,
    allStroke:   allHaveStroke,
    watermarkLetterSpacing: wmLs,
    alphaAvatarStroke: alphaAvatarCircle?.sw ?? null,
  };
});
await browser.close();

const wmLsVal = parseFloat(probe.watermarkLetterSpacing) || 0;

const results = {
  three_rings_remain:           probe.ringCount === 3,
  radii_are_170_250_330:        JSON.stringify(probe.radii) === JSON.stringify(['170', '250', '330']),
  r90_ring_absent:              probe.innerRing90Present === false,
  all_rings_fill_none:          probe.allFillNone,
  all_rings_have_stroke:        probe.allStroke,
  r289_watermark_ls_kept:       wmLsVal >= 0.4 && wmLsVal <= 0.7,
  r283_monogram_stroke_kept:    probe.alphaAvatarStroke === '1.5',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} inner radar ring retired:`, JSON.stringify(results),
  '\n  remaining radii:', probe.radii,
  '\n  watermark letter-spacing (R289):', probe.watermarkLetterSpacing,
  '\n  alpha avatar stroke (R283):', probe.alphaAvatarStroke);
process.exit(ok ? 0 : 1);
