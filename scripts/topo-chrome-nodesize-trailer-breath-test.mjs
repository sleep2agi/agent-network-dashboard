/* Round 708 — chrome nodeSize wrapper at-rest breath at 19s. Mirror to
 * R707 Layout 17s — both chrome control-tier wrappers carry the same
 * alpha (6%) + :has(button:hover) gate. Two coprime prime cadences
 * (17, 19) form a chrome-control respiratory pair, pattern-parallel
 * to canvas-brand-pair (R704/R705) coprime envelope pair.
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
await page.waitForSelector('[data-topo-chrome-fleet-group-trailer]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const wrap = document.querySelector('[data-topo-chrome-fleet-group-trailer]');
  if (!wrap) return null;
  const cs = getComputedStyle(wrap);
  return {
    has_class: wrap.classList.contains('anet-topo-chrome-fleet-group-trailer-breath'),
    breath_attr: wrap.getAttribute('data-topo-chrome-fleet-group-trailer-breath'),
    anim_name: cs.animationName,
    anim_duration: cs.animationDuration,
    anim_iter: cs.animationIterationCount,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');

const cssKeyframes = /@keyframes anet-topo-chrome-fleet-group-trailer-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{\s*opacity:\s*1;\s*\}[\s\S]*?50%\s*\{\s*opacity:\s*0\.94;/.test(cssSrc);
const cssRule = /\.anet-topo-chrome-fleet-group-trailer-breath\s*\{[\s\S]*?animation:\s*anet-topo-chrome-fleet-group-trailer-breath-kf\s+19s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssHoverGate = /\.anet-topo-chrome-fleet-group-trailer-breath:has\(button:hover\)\s*\{\s*animation:\s*none/.test(cssSrc);
const cssReducedMotion = /prefers-reduced-motion:\s*reduce\s*\)\s*\{\s*\.anet-topo-chrome-fleet-group-trailer-breath\s*\{\s*animation:\s*none/.test(cssSrc);
const tsxClass = /anet-topo-chrome-fleet-group-trailer-breath flex items-center/.test(tsxSrc);
const tsxAttr = /data-topo-chrome-fleet-group-trailer-breath="19s"/.test(tsxSrc);

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-chrome-fleet-group-trailer-breath-kf' || runtimeState?.anim_name === 'none';
const runtimeDuration = runtimeState?.anim_duration === '19s' || runtimeState?.anim_name === 'none';

const results = {
  wrapper_present:       !!runtimeState,
  has_breath_class:      runtimeState?.has_class === true,
  breath_attr_19s:       runtimeState?.breath_attr === '19s',
  runtime_anim_ok:       runtimeAnim,
  runtime_duration_ok:   runtimeDuration,
  css_keyframes:         cssKeyframes,
  css_rule:              cssRule,
  css_hover_gate:        cssHoverGate,
  css_reduced_motion:    cssReducedMotion,
  tsx_class:             tsxClass,
  tsx_breath_attr:       tsxAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R708 chrome nodeSize wrapper at-rest breath (19s prime, :has hover-gated, mirror to R707 Layout):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
