/* Round 85 verification: group-box perimeter "marches" when the group
 * has at least one working member, and neither hover nor pin is
 * active. Pin/hover already carry their own emphasis via solid stroke
 * — adding marching ants on top would feel busy. So the live
 * treatment is exclusive to the resting state of a working group.
 *
 * Drive 4 groups via mocked /api/hub/status:
 *   alpha: 2 working    → live
 *   beta:  2 idle       → static
 *   gamma: 1 working + 1 idle → live
 *   delta: 2 offline    → static
 *
 * Then verify pinning a live group drops it from the live class
 * (mirrors R68 transient-priority ordering).
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

const fresh   = new Date(Date.now() - 60 * 1000).toISOString();
const stale10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, ts) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: ts, updated_at: ts, last_seen_at: ts,
  });
  const sessions = [
    mk('alpha1', 'working', fresh),
    mk('alpha2', 'working', fresh),
    mk('beta1',  'idle',    fresh),
    mk('beta2',  'idle',    fresh),
    mk('gamma1', 'working', fresh),
    mk('gamma2', 'idle',    fresh),
    mk('delta1', 'offline', stale10),
    mk('delta2', 'offline', stale10),
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('[data-group-box-live]').length >= 4, { timeout: 30000 });
await page.waitForTimeout(400);

const liveByGroup = () => page.evaluate(() => {
  const out = {};
  for (const g of document.querySelectorAll('g[data-group]')) {
    const key  = g.getAttribute('data-group');
    const rect = g.querySelector('rect[data-group-box-live]');
    out[key] = {
      live:   rect?.getAttribute('data-group-box-live'),
      classy: !!rect?.classList.contains('anet-topo-groupbox-live'),
    };
  }
  return out;
});

const before = await liveByGroup();

// Pin alpha (which is currently live). After pinning, alpha should
// drop the live class — R85 explicitly mutes the ambient marching
// when a stronger emphasis (pin) is active.
await page.locator('[data-group-label-hit="alpha"]').click();
await page.waitForTimeout(250);
const afterAlphaPin = await liveByGroup();

await browser.close();

const results = {
  alpha_live:           before.alpha?.live === 'true' && before.alpha?.classy,
  gamma_live:           before.gamma?.live === 'true' && before.gamma?.classy,
  beta_static:          before.beta?.live  === 'false' && !before.beta?.classy,
  delta_static:         before.delta?.live === 'false' && !before.delta?.classy,
  alphaPin_dropsLive:   afterAlphaPin.alpha?.live  === 'false' && !afterAlphaPin.alpha?.classy,
  alphaPin_gammaUnchanged: afterAlphaPin.gamma?.live === 'true' && afterAlphaPin.gamma?.classy,
  alphaPin_betaUnchanged:  afterAlphaPin.beta?.live  === 'false',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} groupbox-live:`, JSON.stringify(results),
  `\n  before=`,        before,
  `\n  afterAlphaPin=`, afterAlphaPin);
process.exit(ok ? 0 : 1);
