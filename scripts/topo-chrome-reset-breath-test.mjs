/* Round 718 — chrome reset button respiratory anchor at 21 s.
 * 5th anchor on the chrome-strip pattern (extends "tiered-with-trio"
 * → "tiered-with-quartet"). First ATOMIC chrome button to breathe
 * (the prior 4 anchors were 3 segmented-control wrappers + 1 data
 * readout). Hover-gate piggybacks on existing data-topo-chrome-
 * reset-hover attr — sibling pattern to R703 zoom-level leaf-element
 * gate (vs R707/R708/R709 wrapper :has() gate).
 *
 * Assertions:
 *   - reset button present with breath class + breath-cadence attr "21s"
 *   - hover attr defaults to "false" at rest (gate inactive)
 *   - CSS @keyframes has 0%,100% opacity:1 and 50% opacity:0.93
 *   - .anet-topo-chrome-reset-breath rule binds 21s cadence
 *   - hover-gate selector `[data-topo-chrome-reset-hover="true"]`
 *     sets animation:none
 *   - prefers-reduced-motion guard present
 *   - R710 rolodex catalog includes "21": ["reset button"] entry
 *   - R717 patterns catalog chrome-strip entry has cadence 21 + anchor
 *     "reset button" + shape "tiered-with-quartet"
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
await page.waitForSelector('[data-topo-chrome-reset]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const btn = document.querySelector('[data-topo-chrome-reset]');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return {
    has_class:         btn.classList.contains('anet-topo-chrome-reset-breath'),
    breath_attr:       btn.getAttribute('data-topo-chrome-reset-breath'),
    hover_attr:        btn.getAttribute('data-topo-chrome-reset-hover'),
    anim_name:         cs.animationName,
    anim_duration:     cs.animationDuration,
    rolodex_attr:      svg?.getAttribute('data-topo-respiratory-rolodex') ?? null,
    patterns_attr:     svg?.getAttribute('data-topo-respiratory-patterns') ?? null,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssKfNorm = /@keyframes anet-topo-chrome-reset-breath-kf\s*\{[\s\S]*?0%,\s*100%\s*\{[\s\S]*?opacity:\s*1\s*;?[\s\S]*?\}/.test(cssSrc);
const cssKfMid  = /@keyframes anet-topo-chrome-reset-breath-kf\s*\{[\s\S]*?50%\s*\{[\s\S]*?opacity:\s*0\.93/.test(cssSrc);
const cssBind21 = /\.anet-topo-chrome-reset-breath\s*\{[\s\S]*?animation:\s*anet-topo-chrome-reset-breath-kf\s+21s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssHoverGate = /\.anet-topo-chrome-reset-breath\[data-topo-chrome-reset-hover="true"\]\s*\{\s*animation:\s*none/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-chrome-reset-breath\s*\{\s*animation:\s*none/.test(cssSrc);

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-chrome-reset-breath-kf' || runtimeState?.anim_name === 'none';

let rolodex = null;
let patterns = null;
try {
  rolodex  = JSON.parse(runtimeState?.rolodex_attr  ?? '');
  patterns = JSON.parse(runtimeState?.patterns_attr ?? '');
} catch {}
const rolodexHas21 = !!rolodex && Array.isArray(rolodex['21']) && rolodex['21'].includes('reset button');
const chromeStripEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'chrome-strip') : null;
const patternsChromeStripHas21AndReset =
  !!chromeStripEntry
  && Array.isArray(chromeStripEntry.cadences) && chromeStripEntry.cadences.includes(21)
  && Array.isArray(chromeStripEntry.anchors) && chromeStripEntry.anchors.includes('reset button')
  && chromeStripEntry.shape === 'tiered-with-quartet';

const results = {
  button_present:                 !!runtimeState,
  has_breath_class:               runtimeState?.has_class === true,
  breath_attr_21s:                runtimeState?.breath_attr === '21s',
  rest_not_hover:                 runtimeState?.hover_attr === 'false',
  runtime_anim_ok:                runtimeAnim,
  css_keyframes_norm:             cssKfNorm,
  css_keyframes_mid_0_93:         cssKfMid,
  css_class_binds_21s:            cssBind21,
  css_hover_gate_present:         cssHoverGate,
  css_reduced_motion_guard:       cssReducedMotion,
  rolodex_has_21_reset:           rolodexHas21,
  patterns_chrome_strip_5_anchors: patternsChromeStripHas21AndReset,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R718 chrome reset button breath (5th chrome-strip anchor, atomic-control tier @ 21s):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify({ has_class: runtimeState?.has_class, breath_attr: runtimeState?.breath_attr, hover_attr: runtimeState?.hover_attr, anim_name: runtimeState?.anim_name, anim_duration: runtimeState?.anim_duration })}`,
  `\n  chrome-strip pattern: ${JSON.stringify(chromeStripEntry)}`);
process.exit(ok ? 0 : 1);
