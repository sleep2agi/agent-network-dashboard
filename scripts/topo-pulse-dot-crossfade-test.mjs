/* Round 214 verification: working-status pulse dot always-mounts;
 * visibility crossfades via parent <g> opacity instead of mount/
 * unmount snap. Extends R181/R182/R183/R213 always-mount-opacity-
 * gate idiom down to per-node grain.
 *
 * Test (cyber dark, 4 sessions in mixed status):
 *   1. 4 [data-pulse-wrapper] elements present (one per node —
 *      always-mounted regardless of status).
 *   2. Working sessions: data-pulse-visible='true', wrapper
 *      opacity = 1.
 *   3. Non-working sessions: data-pulse-visible='false', wrapper
 *      opacity = 0.
 *   4. Each wrapper has inline transition: 'opacity 300ms ease-out'.
 *   5. Each wrapper contains the inner <circle> with the SMIL
 *      <animate> still present (working-rate pulse R24 preserved).
 *   6. SMIL animate attributeName='opacity', values cycling 1→0.25.
 *
 * The key invariant — pulse dot wrapper is DOM-present for ALL
 * sessions (working and non-working), with visibility purely a
 * CSS opacity gate.
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 2 working + 1 idle + 1 offline — pulse dot only mounts visibly for
  // working, but R214 keeps wrapper in DOM for all 4
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'working'),
    mk('gamma', 'idle'),
    mk('delta', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-pulse-wrapper]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-pulse-wrapper]')].map(el => {
    const cs = getComputedStyle(el);
    const inner = el.querySelector('circle');
    const animate = inner?.querySelector('animate');
    return {
      alias:       el.getAttribute('data-pulse-wrapper'),
      visible:     el.getAttribute('data-pulse-visible'),
      opacity:     parseFloat(cs.opacity),
      transition:  el.style.transition,
      hasInner:    !!inner,
      animateAttr: animate?.getAttribute('attributeName'),
      animateVals: animate?.getAttribute('values'),
    };
  });
});

await browser.close();

const alpha    = probe.find(p => p.alias === 'alpha');
const beta     = probe.find(p => p.alias === 'beta');
const gamma    = probe.find(p => p.alias === 'gamma');
const delta    = probe.find(p => p.alias === 'delta');

const near = (got, want, tol = 0.05) => Math.abs(got - want) < tol;

const results = {
  // All 4 wrappers in DOM regardless of status
  four_wrappers_in_dom:      probe.length === 4,
  alpha_in_dom:              !!alpha,
  beta_in_dom:               !!beta,
  gamma_in_dom:              !!gamma,
  delta_in_dom:              !!delta,

  // Working sessions: visible=true, opacity 1
  alpha_visible:             alpha?.visible === 'true',
  alpha_opacity_1:           near(alpha?.opacity ?? 0, 1),
  beta_visible:              beta?.visible === 'true',
  beta_opacity_1:            near(beta?.opacity ?? 0, 1),

  // Non-working: visible=false, opacity 0
  gamma_hidden:              gamma?.visible === 'false',
  gamma_opacity_0:           near(gamma?.opacity ?? 1, 0),
  delta_hidden:              delta?.visible === 'false',
  delta_opacity_0:           near(delta?.opacity ?? 1, 0),

  // Inline transition includes opacity 300ms
  all_have_transition:       probe.every(p => /opacity\s+(?:300ms|0\.3s)/.test(p.transition || '')),

  // Inner <circle> + SMIL <animate> still present in working wrappers
  // (R24 working-rate pulse preserved)
  alpha_has_inner:           alpha?.hasInner === true,
  alpha_animate_opacity:     alpha?.animateAttr === 'opacity',
  alpha_animate_values:      alpha?.animateVals === '1;0.25;1',
  // Even hidden wrappers keep inner circle in DOM (always-mount)
  gamma_has_inner:           gamma?.hasInner === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pulse-dot crossfade:`, JSON.stringify(results),
  `\n  probe:`, probe);
process.exit(ok ? 0 : 1);
