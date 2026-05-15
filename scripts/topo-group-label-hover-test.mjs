/* Round 86 verification: hovering a group label previews the same
 * dim mechanism as hovering a member node. R63 wired click-to-pin
 * but forgot the hover preview — same R83 hover/click consistency
 * gap. Now closed for group labels too.
 *
 * Fleet: 3 alpha + 2 beta in grid layout. Hover alpha label →
 * alpha nodes stay bright, beta nodes dim. Hover beta label →
 * inverse. Click alpha label → pin (R63 existing). Hover beta
 * while alpha pinned → live transient preview of beta, alpha dims.
 * Leave beta label → alpha pin restores (activeGroup =
 * hoveredGroup ?? pinnedGroup).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
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
  const sessions = [mk('alpha1'), mk('alpha2'), mk('alpha3'), mk('beta1'), mk('beta2')];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('[data-group-label-hit]').length >= 2, { timeout: 30000 });
await page.waitForTimeout(400);

const ops = () => page.evaluate(() => {
  const o = {};
  for (const a of ['alpha1', 'alpha2', 'alpha3', 'beta1', 'beta2']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});

const before = await ops();

// Hover the alpha label — alphas should stay bright, betas dim.
await page.locator('[data-group-label-hit="alpha"]').hover();
await page.waitForTimeout(250);
const onHoverAlpha = await ops();

// Leave (move mouse far away) — baseline restores.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterLeaveAlpha = await ops();

// Hover beta label — inverse.
await page.locator('[data-group-label-hit="beta"]').hover();
await page.waitForTimeout(250);
const onHoverBeta = await ops();

await page.mouse.move(10, 10);
await page.waitForTimeout(250);

// Click alpha label to pin → alpha pinned (R63 behaviour preserved).
await page.locator('[data-group-label-hit="alpha"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterPinAlpha = await ops();

// Hover beta while alpha is pinned — transient preview wins.
await page.locator('[data-group-label-hit="beta"]').hover();
await page.waitForTimeout(250);
const onHoverBetaWhilePin = await ops();

// Leave beta — alpha pin restores.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterLeaveBetaWhilePin = await ops();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_baseline:           bright(before.alpha1) && bright(before.beta1),
  hoverAlpha_alphasBright:   bright(onHoverAlpha.alpha1) && bright(onHoverAlpha.alpha2) && bright(onHoverAlpha.alpha3),
  hoverAlpha_betasDim:       dim(onHoverAlpha.beta1) && dim(onHoverAlpha.beta2),
  leaveAlpha_restores:       bright(afterLeaveAlpha.alpha1) && bright(afterLeaveAlpha.beta1),
  hoverBeta_betasBright:     bright(onHoverBeta.beta1) && bright(onHoverBeta.beta2),
  hoverBeta_alphasDim:       dim(onHoverBeta.alpha1) && dim(onHoverBeta.alpha2),
  pinAlpha_keepsAlpha:       bright(afterPinAlpha.alpha1) && bright(afterPinAlpha.alpha2),
  pinAlpha_dimsBeta:         dim(afterPinAlpha.beta1) && dim(afterPinAlpha.beta2),
  hoverBetaPin_transient:    bright(onHoverBetaWhilePin.beta1) && dim(onHoverBetaWhilePin.alpha1),
  leaveBetaPin_alphaRestored: bright(afterLeaveBetaWhilePin.alpha1) && dim(afterLeaveBetaWhilePin.beta1),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-label hover:`, JSON.stringify(results),
  `\n  before=`,            before,
  `\n  onHoverAlpha=`,      onHoverAlpha,
  `\n  onHoverBeta=`,       onHoverBeta,
  `\n  afterPinAlpha=`,     afterPinAlpha,
  `\n  onHoverBetaPin=`,    onHoverBetaWhilePin,
  `\n  leaveBetaPin=`,      afterLeaveBetaWhilePin);
process.exit(ok ? 0 : 1);
