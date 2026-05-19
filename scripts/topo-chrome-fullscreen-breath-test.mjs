/* Round 719 — chrome fullscreen button respiratory anchor at 25 s.
 * 6th anchor on the chrome-strip pattern, completing the ATOMIC-CONTROL
 * DUO with R718 reset (21 s + 25 s, parity 7% alpha range). Shape
 * advances "tiered-with-quartet" → "tiered-with-quintet". 25 = 5²,
 * coprime with every other rolodex cadence (no other factor-5 anywhere)
 * — new slowest cadence on the rolodex.
 *
 * Assertions:
 *   - fullscreen button present with breath class + breath-cadence "25s"
 *   - hover attr defaults to "false" at rest (gate inactive)
 *   - CSS @keyframes 0%,100% opacity:1, 50% opacity:0.93 (parity to R718)
 *   - .anet-topo-chrome-fullscreen-breath rule binds 25s cadence
 *   - hover-gate selector `[data-topo-chrome-fullscreen-hover="true"]`
 *   - prefers-reduced-motion guard present
 *   - R710 rolodex catalog includes "25": ["fullscreen button"]
 *   - R717 patterns chrome-strip entry has cadence 25 + anchor
 *     "fullscreen button" + shape "tiered-with-quintet"
 *   - duo cadences (21, 25) both present in chrome-strip cadences
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
await page.waitForSelector('[data-topo-chrome-fullscreen]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const btn = document.querySelector('[data-topo-chrome-fullscreen]');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return {
    has_class:         btn.classList.contains('anet-topo-chrome-fullscreen-breath'),
    breath_attr:       btn.getAttribute('data-topo-chrome-fullscreen-breath'),
    hover_attr:        btn.getAttribute('data-topo-chrome-fullscreen-hover'),
    anim_name:         cs.animationName,
    anim_duration:     cs.animationDuration,
    rolodex_attr:      svg?.getAttribute('data-topo-respiratory-rolodex') ?? null,
    patterns_attr:     svg?.getAttribute('data-topo-respiratory-patterns') ?? null,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssKfNorm = /@keyframes anet-topo-chrome-fullscreen-breath-kf\s*\{[\s\S]*?0%,\s*100%\s*\{[\s\S]*?opacity:\s*1\s*;?[\s\S]*?\}/.test(cssSrc);
const cssKfMid  = /@keyframes anet-topo-chrome-fullscreen-breath-kf\s*\{[\s\S]*?50%\s*\{[\s\S]*?opacity:\s*0\.93/.test(cssSrc);
const cssBind25 = /\.anet-topo-chrome-fullscreen-breath\s*\{[\s\S]*?animation:\s*anet-topo-chrome-fullscreen-breath-kf\s+25s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssHoverGate = /\.anet-topo-chrome-fullscreen-breath\[data-topo-chrome-fullscreen-hover="true"\]\s*\{\s*animation:\s*none/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-chrome-fullscreen-breath\s*\{\s*animation:\s*none/.test(cssSrc);

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-chrome-fullscreen-breath-kf' || runtimeState?.anim_name === 'none';

let rolodex = null;
let patterns = null;
try {
  rolodex  = JSON.parse(runtimeState?.rolodex_attr  ?? '');
  patterns = JSON.parse(runtimeState?.patterns_attr ?? '');
} catch {}
const rolodexHas25 = !!rolodex && Array.isArray(rolodex['25']) && rolodex['25'].includes('fullscreen button');
const chromeStripEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'chrome-strip') : null;
const patternsChromeStripHas25AndFullscreen =
  !!chromeStripEntry
  && Array.isArray(chromeStripEntry.cadences) && chromeStripEntry.cadences.includes(25)
  && Array.isArray(chromeStripEntry.anchors) && chromeStripEntry.anchors.includes('fullscreen button')
  && chromeStripEntry.shape === 'tiered-with-quintet';
const atomicDuoBothPresent =
  !!chromeStripEntry
  && chromeStripEntry.cadences.includes(21)
  && chromeStripEntry.cadences.includes(25)
  && chromeStripEntry.anchors.includes('reset button')
  && chromeStripEntry.anchors.includes('fullscreen button');

const results = {
  button_present:                   !!runtimeState,
  has_breath_class:                 runtimeState?.has_class === true,
  breath_attr_25s:                  runtimeState?.breath_attr === '25s',
  rest_not_hover:                   runtimeState?.hover_attr === 'false',
  runtime_anim_ok:                  runtimeAnim,
  css_keyframes_norm:               cssKfNorm,
  css_keyframes_mid_0_93:           cssKfMid,
  css_class_binds_25s:              cssBind25,
  css_hover_gate_present:           cssHoverGate,
  css_reduced_motion_guard:         cssReducedMotion,
  rolodex_has_25_fullscreen:        rolodexHas25,
  patterns_chrome_strip_6_anchors:  patternsChromeStripHas25AndFullscreen,
  atomic_control_duo_complete:      atomicDuoBothPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R719 chrome fullscreen button breath (6th chrome-strip anchor, atomic-control DUO complete @ 25s):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify({ has_class: runtimeState?.has_class, breath_attr: runtimeState?.breath_attr, hover_attr: runtimeState?.hover_attr, anim_name: runtimeState?.anim_name, anim_duration: runtimeState?.anim_duration })}`,
  `\n  chrome-strip pattern: ${JSON.stringify(chromeStripEntry)}`);
process.exit(ok ? 0 : 1);
