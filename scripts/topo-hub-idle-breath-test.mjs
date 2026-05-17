/* Round 497 verification: hub-highlight circle (data-topo-hub-highlight)
 * gets a SMIL idle-breath (0.85↔1.0 over 4s) when workingCount === 0 &&
 * !reducedMotion. Signals "fleet alive but quiet" on the empty-state
 * canvas. Pivot away from R492-R496 press-family arc into 呼吸感 theme.
 *
 * Test scenarios:
 *  1. Empty fleet (no sessions) → hub-highlight visible + animate child rendered
 *  2. Empty fleet + prefers-reduced-motion → static, no animate
 *  3. Busy fleet (working session) → hub-highlight invisible, no animate
 *  4. data-topo-hub-highlight-breath attr surfaces gate state for each
 *  5. Source-file: animate child wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe({ sessions, reducedMotion }) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1200 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
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
    const mk = (alias, status) => ({
      alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: sessions.map((s) => mk(s.alias, s.status)) } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-topo-hub-highlight]', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const circle = document.querySelector('[data-topo-hub-highlight]');
    if (!circle) return null;
    const breath = circle.getAttribute('data-topo-hub-highlight-breath');
    const visible = circle.getAttribute('data-topo-hub-highlight-visible');
    const animateChild = circle.querySelector('animate[attributeName="opacity"]');
    return {
      breath_attr: breath,
      visible_attr: visible,
      has_animate: !!animateChild,
      animate_values: animateChild && animateChild.getAttribute('values'),
      animate_dur:    animateChild && animateChild.getAttribute('dur'),
    };
  });
  await browser.close();
  return result;
}

// Empty sessions array triggers the empty-state placeholder which doesn't
// render the SVG hub. For workingCount===0 with hub rendered, use an
// 'idle' session — fleet exists but no node is working.
const idle  = await probe({ sessions: [{ alias: 'a·1', status: 'idle' }], reducedMotion: false });
const idleA11y = await probe({ sessions: [{ alias: 'a·1', status: 'idle' }], reducedMotion: true  });
const busy  = await probe({ sessions: [{ alias: 'a·1', status: 'working' }], reducedMotion: false });

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// R508 refactor: IIFE with `breathActive` const.
// R511 extension: breathActive also gates on !hoveredHub (hub-hover
// amplifies highlight to 1.0; breath halts during the lift). Regex
// updated to match. Runtime DOM contract (idle visible/busy invisible/
// a11y no-animate) unchanged.
const sourceWired = /const breathActive = !reducedMotion && workingCount === 0 && !hubRecede && !hoveredHub;[\s\S]*?\{breathActive && \(\s*<animate attributeName="opacity" values="0\.85;1;0\.85" dur="4s" repeatCount="indefinite"/.test(src);
const breathAttrWired = /data-topo-hub-highlight-breath=\{breathActive \? 'true' : 'false'\}/.test(src);

const results = {
  // Idle + motion: visible + animate present + breath='true'
  idle_visible:        idle && idle.visible_attr === 'true',
  idle_has_animate:    idle && idle.has_animate,
  idle_breath_true:    idle && idle.breath_attr === 'true',
  idle_animate_values: idle && idle.animate_values === '0.85;1;0.85',
  idle_animate_dur:    idle && idle.animate_dur === '4s',
  // Idle + reducedMotion: visible but NO animate, breath='false'
  a11y_visible:        idleA11y && idleA11y.visible_attr === 'true',
  a11y_no_animate:     idleA11y && !idleA11y.has_animate,
  a11y_breath_false:   idleA11y && idleA11y.breath_attr === 'false',
  // Busy: invisible + no animate (workingCount > 0)
  busy_invisible:      busy && busy.visible_attr === 'false',
  busy_no_animate:     busy && !busy.has_animate,
  busy_breath_false:   busy && busy.breath_attr === 'false',
  // Source
  source_animate_wired: sourceWired,
  source_breath_attr_wired: breathAttrWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R497 hub idle breath:`, JSON.stringify(results),
  '\n  idle:', JSON.stringify(idle),
  '\n  a11y:', JSON.stringify(idleA11y),
  '\n  busy:', JSON.stringify(busy));
process.exit(ok ? 0 : 1);
