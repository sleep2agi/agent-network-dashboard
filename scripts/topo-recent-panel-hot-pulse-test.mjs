/* Round 634 — panel header hot-count tspan joins hot-pulse family
 * at the panel-aggregate tier. ClassName composition combines the
 * one-shot 'anet-fade-in' mount fade with the continuous
 * 'anet-recent-hot-pulse' breath when hotFlowCount > 0 &&
 * !reducedMotion. 4th anchor in hot-pulse family.
 *
 * Test phases:
 *   1. cold (3 messages on one edge → no hot lane): hot-count
 *      tspan present but hidden (opacity=0); pulse attr 'off';
 *      className === 'anet-fade-in' (no breath)
 *   2. hot (12 messages on one edge → 1 hot lane): tspan visible
 *      (opacity=1); pulse attr 'on'; className contains
 *      'anet-recent-hot-pulse'; computed animation-name resolves
 *      to anet-recent-hot-pulse-kf
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function shoot(messageCount, label) {
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
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages:
    Array.from({ length: messageCount }, (_, i) => ({
      from_alias: 'a·1', to_alias: 'a·2', content: `msg-${i}`, created_at: fresh,
    }))
  } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-recent-panel-hot-count]', { timeout: 15000, state: 'attached' });
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => {
    const el = document.querySelector('[data-recent-panel-hot-count]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      hotCount:      el.getAttribute('data-recent-panel-hot-count'),
      hotVisible:    el.getAttribute('data-recent-panel-hot-visible'),
      hotPulseAttr:  el.getAttribute('data-recent-panel-hot-pulse'),
      cls:           el.getAttribute('class') || '',
      opacity:       el.getAttribute('opacity'),
      animName:      cs.animationName,
      animDuration:  cs.animationDuration,
      animIter:      cs.animationIterationCount,
    };
  });
  await browser.close();
  return { label, state };
}

const cold = await shoot(3,  'cold');
const hot  = await shoot(12, 'hot');

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceClassNameGate = /className=\{hotFlowCount > 0 && !reducedMotion\s*\?\s*'anet-fade-in anet-recent-hot-pulse'\s*:\s*'anet-fade-in'\}/.test(src);
const sourcePulseAttr = /data-recent-panel-hot-pulse=\{hotFlowCount > 0 && !reducedMotion \? 'on' : 'off'\}/.test(src);

const results = {
  cold_present:           !!cold.state,
  cold_hot_count_0:       cold.state?.hotCount === '0',
  cold_visible_false:     cold.state?.hotVisible === 'false',
  cold_pulse_off:         cold.state?.hotPulseAttr === 'off',
  cold_opacity_0:         cold.state?.opacity === '0',
  cold_cls_no_pulse:      !/anet-recent-hot-pulse/.test(cold.state?.cls || ''),
  cold_cls_has_fade_in:   /anet-fade-in/.test(cold.state?.cls || ''),
  hot_present:            !!hot.state,
  hot_count_1:            hot.state?.hotCount === '1',
  hot_visible_true:       hot.state?.hotVisible === 'true',
  hot_pulse_on:           hot.state?.hotPulseAttr === 'on',
  hot_opacity_1:          hot.state?.opacity === '1',
  hot_cls_has_pulse:      /anet-recent-hot-pulse/.test(hot.state?.cls || ''),
  hot_cls_has_fade_in:    /anet-fade-in/.test(hot.state?.cls || ''),
  // CSS animation-name may include both anet-fade-in + anet-recent-hot-pulse-kf
  hot_anim_name_includes_kf:  /anet-recent-hot-pulse-kf/.test(hot.state?.animName || ''),
  source_className_gate:  sourceClassNameGate,
  source_pulse_attr:      sourcePulseAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R634 recent-panel hot-count pulse (4th hot-pulse anchor):`,
  JSON.stringify(results, null, 2),
  `\n  cold: ${JSON.stringify(cold.state)}`,
  `\n  hot:  ${JSON.stringify(hot.state)}`);
process.exit(ok ? 0 : 1);
