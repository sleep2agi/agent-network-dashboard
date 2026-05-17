/* Round 498 verification: recent-signal row hot-count tspan gains a
 * 3s opacity pulse (0.85↔1.0) when count >= 10 (isHot && !reducedMotion).
 * Adds the 呼吸感 theme's second anchor after R497 hub idle-breath —
 * gentle motion attracts glance to high-traffic lanes.
 *
 * Test scenarios — needs >= 10 messages between two aliases to trigger
 * the hot threshold AND the recent-signal panel to render. Uses a
 * messages fixture with 10 messages from alpha·a1 → alpha·a2.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe({ reducedMotion }) {
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
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha·a1', 'working'),
      mk('alpha·a2', 'idle'),
    ] } });
  });
  // 12 messages → count >= 10 → isHot true
  const msgs = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`, from_alias: 'alpha·a1', to_alias: 'alpha·a2',
    content: 'test', created_at: fresh,
  }));
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const tspans = Array.from(document.querySelectorAll('[data-recent-row-count]'));
    const hotTspan = tspans.find((t) => t.getAttribute('data-recent-row-count-hot') === 'true');
    if (!hotTspan) return { found: false, totalTspans: tspans.length };
    const cs = window.getComputedStyle(hotTspan);
    return {
      found: true,
      class_has_pulse: /anet-recent-hot-pulse/.test(hotTspan.getAttribute('class') || ''),
      pulse_attr:      hotTspan.getAttribute('data-recent-row-count-hot-pulse'),
      animation_name:  cs.animationName,
      animation_duration: cs.animationDuration,
    };
  });
  await browser.close();
  return result;
}

const motion = await probe({ reducedMotion: false });
const a11y   = await probe({ reducedMotion: true  });

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const css = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const sourceClassWired = /className=\{isHot && !reducedMotion \? 'anet-recent-hot-pulse' : undefined\}/.test(src);
const sourceAttrWired  = /data-recent-row-count-hot-pulse=\{isHot && !reducedMotion \? 'true' : 'false'\}/.test(src);
const cssKeyframeWired = /@keyframes anet-recent-hot-pulse-kf\s*\{[\s\S]*?opacity:\s*0\.85[\s\S]*?opacity:\s*1[\s\S]*?\}/.test(css);
const cssClassWired    = /\.anet-recent-hot-pulse\s*\{\s*animation:\s*anet-recent-hot-pulse-kf 3s ease-in-out infinite/.test(css);

const results = {
  // Motion fixture: tspan found + class applied + attr='true' + animation runs
  motion_hot_found:    motion.found,
  motion_class_pulse:  motion.found && motion.class_has_pulse,
  motion_attr_true:    motion.found && motion.pulse_attr === 'true',
  motion_anim_name:    motion.found && motion.animation_name === 'anet-recent-hot-pulse-kf',
  // a11y fixture: class still absent (component-side gate) — attr='false'
  a11y_hot_found:      a11y.found,
  a11y_no_class:       a11y.found && !a11y.class_has_pulse,
  a11y_attr_false:     a11y.found && a11y.pulse_attr === 'false',
  // Source/CSS
  source_class_wired:  sourceClassWired,
  source_attr_wired:   sourceAttrWired,
  css_keyframe_wired:  cssKeyframeWired,
  css_class_wired:     cssClassWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R498 recent-row hot pulse:`, JSON.stringify(results),
  '\n  motion:', JSON.stringify(motion),
  '\n  a11y:  ', JSON.stringify(a11y));
process.exit(ok ? 0 : 1);
