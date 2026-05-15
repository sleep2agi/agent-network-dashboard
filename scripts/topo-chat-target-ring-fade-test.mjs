/* Round 183 verification: chat-target ring (R11/R120) fades in/out
 * instead of mount/unmount.
 *
 * Pre-R183 the ring was conditionally mounted on
 * `chatAlias === session.alias`; the className `transition-opacity
 * duration-200` never fired because the element didn't exist
 * before mount. R183 makes the ring always-mounted with opacity
 * gated by isChat — the CSS transition now fires cleanly on
 * chat-close. The SMIL <animate> stays gated by
 * `!reducedMotion && isChat` so it only runs for the active
 * chat target (otherwise SMIL on every node would fight the
 * opacity transition globally).
 *
 * Test:
 *   1. Mock 2 sessions (alpha, beta)
 *   2. Idle: both rings always-mounted, opacity=0, active=false
 *   3. Click alpha → alpha opacity=0.95 active=true,
 *      beta stays opacity=0 active=false
 *   4. Click beta → beta opacity=0.95 active=true,
 *      alpha back to 0 (chatAlias swap)
 *   5. All rings carry 'opacity 200ms ease-out' transition
 *   6. strokeWidth='2.5' (R51 sentinel-safe)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.setItem('anet-topo-layout', 'ring');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForSelector('[data-chat-target-ring]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const rings = [...document.querySelectorAll('g[data-node] [data-chat-target-ring]')];
  return rings.map(r => {
    const node = r.closest('g[data-node]');
    return {
      alias:        node?.getAttribute('data-node'),
      opacity:      parseFloat(r.getAttribute('opacity') || ''),
      active:       r.getAttribute('data-chat-target-active'),
      breath:       r.getAttribute('data-chat-target-breath'),
      strokeWidth:  r.getAttribute('stroke-width'),
      transition:   r.style.transition || getComputedStyle(r).transition,
      hasAnimate:   !!r.querySelector('animate'),
    };
  });
});

const idle = await probe();

await page.locator('g[data-node="alpha"]').click();
await page.waitForTimeout(400);
const onAlpha = await probe();

await page.locator('g[data-node="beta"]').click();
await page.waitForTimeout(400);
const onBeta = await probe();

await browser.close();

const findRing = (rings, alias) => rings.find(r => r.alias === alias);
const hasTransition = (s) =>
  (s.transition || '').includes('opacity 200ms') ||
  /opacity\s+0\.2s|opacity\s+200ms/.test(s.transition || '');

const results = {
  two_rings_present:        idle.length === 2,
  all_strokewidth_2p5:      idle.every(r => r.strokeWidth === '2.5'),
  all_have_transition:      idle.every(r => hasTransition(r)),

  idle_all_opacity_0:       idle.every(r => r.opacity === 0),
  idle_all_inactive:        idle.every(r => r.active === 'false'),
  idle_none_have_animate:   idle.every(r => r.hasAnimate === false),

  // Click alpha → alpha active, beta inactive
  alpha_active_opacity_0p95: Math.abs((findRing(onAlpha, 'alpha')?.opacity ?? 0) - 0.95) < 0.05,
  alpha_active_attr:        findRing(onAlpha, 'alpha')?.active === 'true',
  alpha_breath_on:          findRing(onAlpha, 'alpha')?.breath === 'on',
  alpha_has_animate:        findRing(onAlpha, 'alpha')?.hasAnimate === true,
  beta_inactive_opacity_0:  findRing(onAlpha, 'beta')?.opacity === 0,
  beta_inactive_attr:       findRing(onAlpha, 'beta')?.active === 'false',
  beta_breath_off:          findRing(onAlpha, 'beta')?.breath === 'off',
  beta_no_animate:          findRing(onAlpha, 'beta')?.hasAnimate === false,

  // Click beta → swap; alpha back to 0, beta active
  beta_active_opacity_0p95: Math.abs((findRing(onBeta, 'beta')?.opacity ?? 0) - 0.95) < 0.05,
  beta_active_attr:         findRing(onBeta, 'beta')?.active === 'true',
  alpha_back_to_0:          findRing(onBeta, 'alpha')?.opacity === 0,
  alpha_back_to_inactive:   findRing(onBeta, 'alpha')?.active === 'false',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chat-target ring fade:`, JSON.stringify(results),
  `\n  idle:`, idle,
  `\n  on alpha:`, onAlpha,
  `\n  on beta:`, onBeta);
process.exit(ok ? 0 : 1);
