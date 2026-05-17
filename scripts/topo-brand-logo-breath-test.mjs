/* Round 553 verification: title-block brand logo gains subtle idle
 * opacity breath (0.92 ↔ 1, 5s cycle). 5th anchor in the 呼吸感
 * breath family.
 *
 * Test phases:
 *   1. brand-logo className contains 'anet-topo-brand-logo-breath'
 *   2. data-topo-brand-logo-breath="true" attr present
 *   3. computed animation-name === 'anet-topo-brand-logo-breath-kf'
 *      (paused or running)
 *   4. computed animation-duration === '5s'
 *   5. source-side regex confirms keyframe + class + componentJSX
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-brand-logo]', { timeout: 15000 });
await page.waitForTimeout(500);

const sel = '[data-topo-brand-logo]';
const probe = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    breathAttr:      el.getAttribute('data-topo-brand-logo-breath'),
    hasBreathClass:  el.classList.contains('anet-topo-brand-logo-breath'),
    animationName:     cs.animationName,
    animationDuration: cs.animationDuration,
    animationIterationCount: cs.animationIterationCount,
    animationTimingFunction: cs.animationTimingFunction,
    // Sample opacity twice across ~1.5s to confirm it's actually changing
    opacityNow:      parseFloat(cs.opacity),
  };
}, sel);

// Sample opacity at 3 timepoints across the 5s breath cycle
await page.waitForTimeout(500);
const opacity_t1 = await page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).opacity), sel);
await page.waitForTimeout(900);
const opacity_t2 = await page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).opacity), sel);
await page.waitForTimeout(900);
const opacity_t3 = await page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).opacity), sel);

await browser.close();

const css = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const tsx = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceKeyframe   = /@keyframes anet-topo-brand-logo-breath-kf/.test(css);
const sourceClass      = /\.anet-topo-brand-logo-breath\s*\{[^}]*animation: anet-topo-brand-logo-breath-kf 5s ease-in-out infinite/.test(css);
const sourceComponent  = /\!reducedMotion \? ' anet-topo-brand-logo-breath' : ''/.test(tsx);
const sourceAttr       = /data-topo-brand-logo-breath=\{!reducedMotion \? 'true' : 'false'\}/.test(tsx);

// Opacity should oscillate; not all 3 samples identical
const opacityVaries = new Set([opacity_t1, opacity_t2, opacity_t3].map(o => o.toFixed(3))).size > 1;

const results = {
  breath_attr:                probe?.breathAttr === 'true',
  has_breath_class:           probe?.hasBreathClass === true,
  animation_name_match:       probe?.animationName === 'anet-topo-brand-logo-breath-kf',
  animation_duration_5s:      probe?.animationDuration === '5s',
  animation_iteration_infinite: probe?.animationIterationCount === 'infinite',
  animation_timing_ease_in_out: probe?.animationTimingFunction === 'ease-in-out',
  opacity_varies_over_time:   opacityVaries,
  source_keyframe:            sourceKeyframe,
  source_class:               sourceClass,
  source_component:           sourceComponent,
  source_attr:                sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R553 brand-logo idle breath (5th anchor in 呼吸感 family):`,
  JSON.stringify(results, null, 2),
  '\n  probe:', JSON.stringify(probe),
  `\n  opacity samples: ${opacity_t1.toFixed(3)} → ${opacity_t2.toFixed(3)} → ${opacity_t3.toFixed(3)}`);
process.exit(ok ? 0 : 1);
