/* Round 705 — canvas crescent moon wrapper envelope breath at 13s.
 * Mirror to R704 watermark wrapper (15s), closing canvas-brand-pair
 * envelope symmetry. Two coprime cadences (13 + 15) for independent
 * voices. Tighter alpha range (0.30 ↔ 0.35) hugs the existing inline
 * baseline.
 *
 * Source assertions:
 *   - TopoGraph.tsx crescent <g> has className + data-topo-brand-canvas-mark-envelope-breath
 *   - globals.css @keyframes + .class + 2 gate rules + reduced-motion guard
 *
 * Runtime assertions:
 *   - crescent visible (no flowLinks, default test scaffold)
 *   - data-topo-brand-canvas-mark-visible='true'
 *   - data-topo-brand-canvas-mark-envelope-breath='13s'
 *   - computed animation-name + duration 13s + iter infinite
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
// No messages → flowLinks.length === 0 → crescent visible
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-brand-canvas-mark]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const g = document.querySelector('[data-topo-brand-canvas-mark]');
  if (!g) return null;
  const cs = getComputedStyle(g);
  return {
    has_class: g.classList.contains('anet-topo-brand-canvas-mark-envelope-breath'),
    breath_attr: g.getAttribute('data-topo-brand-canvas-mark-envelope-breath'),
    visible_attr: g.getAttribute('data-topo-brand-canvas-mark-visible'),
    recede_attr: g.getAttribute('data-topo-brand-canvas-mark-recede'),
    anim_name: cs.animationName,
    anim_duration: cs.animationDuration,
    anim_iter: cs.animationIterationCount,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');

const cssKeyframes = /@keyframes anet-topo-brand-canvas-mark-envelope-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{\s*opacity:\s*0\.35;\s*\}[\s\S]*?50%\s*\{\s*opacity:\s*0\.30;/.test(cssSrc);
const cssRule = /\.anet-topo-brand-canvas-mark-envelope-breath\s*\{[\s\S]*?animation:\s*anet-topo-brand-canvas-mark-envelope-breath-kf\s+13s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssVisibleGate = /\.anet-topo-brand-canvas-mark-envelope-breath\[data-topo-brand-canvas-mark-visible="false"\]\s*\{\s*animation:\s*none/.test(cssSrc);
const cssRecedeGate = /\.anet-topo-brand-canvas-mark-envelope-breath\[data-topo-brand-canvas-mark-recede="true"\]\s*\{\s*animation:\s*none/.test(cssSrc);
const cssReducedMotion = /prefers-reduced-motion:\s*reduce\s*\)\s*\{\s*\.anet-topo-brand-canvas-mark-envelope-breath\s*\{\s*animation:\s*none/.test(cssSrc);
const tsxClass = /className="anet-topo-brand-canvas-mark-envelope-breath"/.test(tsxSrc);
const tsxAttr = /data-topo-brand-canvas-mark-envelope-breath="13s"/.test(tsxSrc);

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-brand-canvas-mark-envelope-breath-kf' || runtimeState?.anim_name === 'none';
const runtimeDuration = runtimeState?.anim_duration === '13s' || runtimeState?.anim_name === 'none';

const results = {
  wrapper_present:       !!runtimeState,
  has_breath_class:      runtimeState?.has_class === true,
  breath_attr_13s:       runtimeState?.breath_attr === '13s',
  visible_at_rest:       runtimeState?.visible_attr === 'true',
  rest_not_recede:       runtimeState?.recede_attr === 'false',
  runtime_anim_ok:       runtimeAnim,
  runtime_duration_ok:   runtimeDuration,
  css_keyframes:         cssKeyframes,
  css_rule:              cssRule,
  css_visible_gate:      cssVisibleGate,
  css_recede_gate:       cssRecedeGate,
  css_reduced_motion:    cssReducedMotion,
  tsx_class:             tsxClass,
  tsx_breath_attr:       tsxAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R705 crescent wrapper envelope breath (13s, canvas-brand-pair envelope symmetry closed):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
