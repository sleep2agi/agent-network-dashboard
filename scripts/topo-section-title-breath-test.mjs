/* Round 702 — H2 "Command mesh" at-rest breathing fade. Completes the
 * title-block respiratory trio: brand-logo (R553) 5s + kicker (R699) 6s
 * + H2 (R702) 10s. Tighter alpha range (0.88↔1) than kicker for the
 * heavier text weight.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-section-title]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const h2 = document.querySelector('[data-topo-section-title]');
  if (!h2) return null;
  const cs = getComputedStyle(h2);
  return {
    has_class: h2.classList.contains('anet-topo-section-title-breath'),
    breath_attr: h2.getAttribute('data-topo-section-title-breath'),
    anim_name: cs.animationName,
    anim_duration: cs.animationDuration,
    anim_iter: cs.animationIterationCount,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');

const cssKeyframes = /@keyframes anet-topo-section-title-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{\s*opacity:\s*1;\s*\}[\s\S]*?50%\s*\{\s*opacity:\s*0\.88;/.test(cssSrc);
const cssRule = /\.anet-topo-section-title-breath\s*\{[\s\S]*?animation:\s*anet-topo-section-title-breath-kf\s+10s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssReducedMotion = /prefers-reduced-motion:\s*reduce\s*\)\s*\{\s*\.anet-topo-section-title-breath\s*\{\s*animation:\s*none/.test(cssSrc);
const tsxClass = /anet-topo-section-title-breath text-lg/.test(tsxSrc);
const tsxAttr = /data-topo-section-title-breath="10s"/.test(tsxSrc);

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-section-title-breath-kf' || runtimeState?.anim_name === 'none';
const runtimeDuration = runtimeState?.anim_duration === '10s' || runtimeState?.anim_name === 'none';

const results = {
  h2_present:            !!runtimeState,
  has_breath_class:      runtimeState?.has_class === true,
  breath_attr_10s:       runtimeState?.breath_attr === '10s',
  runtime_anim_ok:       runtimeAnim,
  runtime_duration_ok:   runtimeDuration,
  css_keyframes:         cssKeyframes,
  css_rule:              cssRule,
  css_reduced_motion:    cssReducedMotion,
  tsx_class:             tsxClass,
  tsx_breath_attr:       tsxAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R702 H2 "Command mesh" at-rest breath (title-block trio closed — 10s):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
