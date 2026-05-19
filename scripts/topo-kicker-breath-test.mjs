/* Round 699 — kicker "Network Topology" gains at-rest breathing fade.
 * Pre-R699 the kicker eyebrow sat at fixed alpha (text-gray-500 token)
 * — static, no sign of life. R699 adds a 6s opacity 0.78↔1 cycle via
 * `.anet-topo-kicker-breath` (globals.css). Pure opacity → geometry
 * stable → topo-overlap-test unaffected.
 *
 * Source assertions:
 *   - globals.css @keyframes anet-topo-kicker-breath-kf with 0/100% 1, 50% 0.78
 *   - globals.css .anet-topo-kicker-breath rule with 6s ease-in-out infinite
 *   - globals.css prefers-reduced-motion guard: animation: none
 *   - TopoGraph.tsx kicker element has class anet-topo-kicker-breath
 *   - TopoGraph.tsx kicker element has data-topo-section-kicker-breath="6s"
 *
 * Runtime assertions:
 *   - kicker element present
 *   - kicker has anet-topo-kicker-breath class
 *   - computed animation-name reflects the keyframe (or 'none' under reduced-motion)
 *   - computed animation-duration is 6s
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
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const k = document.querySelector('[data-topo-section-kicker]');
  if (!k) return null;
  const cs = getComputedStyle(k);
  return {
    has_class: k.classList.contains('anet-topo-kicker-breath'),
    breath_attr: k.getAttribute('data-topo-section-kicker-breath'),
    anim_name: cs.animationName,
    anim_duration: cs.animationDuration,
    anim_iter: cs.animationIterationCount,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');

const cssKeyframes = /@keyframes anet-topo-kicker-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{\s*opacity:\s*1;\s*\}[\s\S]*?50%\s*\{\s*opacity:\s*0\.78;/.test(cssSrc);
const cssRule = /\.anet-topo-kicker-breath\s*\{[\s\S]*?animation:\s*anet-topo-kicker-breath-kf\s+6s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssReducedMotion = /prefers-reduced-motion:\s*reduce\s*\)\s*\{\s*\.anet-topo-kicker-breath\s*\{\s*animation:\s*none/.test(cssSrc);
const tsxClass = /anet-topo-kicker-breath text-xs uppercase/.test(tsxSrc);
const tsxAttr = /data-topo-section-kicker-breath="6s"/.test(tsxSrc);

// Runtime animation may be 'none' under prefers-reduced-motion. In default
// headless playwright, motion is allowed by default, so the keyframe should
// be active (anim_name === 'anet-topo-kicker-breath-kf').
const runtimeAnim = runtimeState?.anim_name === 'anet-topo-kicker-breath-kf' || runtimeState?.anim_name === 'none';
const runtimeDuration = runtimeState?.anim_duration === '6s' || runtimeState?.anim_name === 'none';

const results = {
  kicker_present:        !!runtimeState,
  has_breath_class:      runtimeState?.has_class === true,
  breath_attr_6s:        runtimeState?.breath_attr === '6s',
  runtime_anim_ok:       runtimeAnim,
  runtime_duration_ok:   runtimeDuration,
  css_keyframes:         cssKeyframes,
  css_rule:              cssRule,
  css_reduced_motion:    cssReducedMotion,
  tsx_class:             tsxClass,
  tsx_breath_attr:       tsxAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R699 kicker at-rest breathing fade (3rd respiratory rhythm — 6s eyebrow):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
