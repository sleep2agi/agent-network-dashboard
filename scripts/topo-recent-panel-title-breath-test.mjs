/* Round 700 (milestone) — recent panel title gains at-rest SVG opacity
 * breath, paired with R699 kicker breath. New 8s tier in the respiratory
 * rolodex (3/4/5/6/7/8s — each surface a distinct cadence).
 *
 * Source assertions:
 *   - TopoGraph.tsx has data-recent-panel-title-breath="..." attr
 *   - TopoGraph.tsx <animate attributeName="opacity" values="0.78;1;0.78" dur="8s"/>
 *
 * Runtime assertions:
 *   - title element present
 *   - data-recent-panel-title-breath='8s' at rest (!activeEdgeKey)
 *   - <animate> child element present at rest with dur="8s"
 *   - animate child absent when activeEdgeKey would be true (we can't trigger
 *     pin from outside without complex DOM interaction; verify rest-state only)
 *
 * Mock 3 messages so the recent-signal panel renders with content.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2'), mk('a·3')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', kind: 'message', content: 'p', network_id: 'default', created_at: fresh },
  { id: 'm2', from_alias: 'a·2', to_alias: 'a·3', kind: 'message', content: 'q', network_id: 'default', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-panel-title]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const title = document.querySelector('[data-recent-panel-title]');
  if (!title) return null;
  const animate = title.querySelector('animate[attributeName="opacity"]');
  return {
    title_present: true,
    breath_attr: title.getAttribute('data-recent-panel-title-breath'),
    active_attr: title.getAttribute('data-recent-panel-title-active'),
    animate_present: !!animate,
    animate_dur: animate?.getAttribute('dur'),
    animate_values: animate?.getAttribute('values'),
    animate_repeat: animate?.getAttribute('repeatCount'),
  };
});

await browser.close();

const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const tsxBreathAttr = /data-recent-panel-title-breath=\{!reducedMotion && !activeEdgeKey \? '8s' : 'off'\}/.test(tsxSrc);
const tsxAnimate = /<animate attributeName="opacity" values="0\.78;1;0\.78" dur="8s" repeatCount="indefinite" \/>/.test(tsxSrc);

const results = {
  title_present:           !!runtimeState?.title_present,
  rest_breath_8s:          runtimeState?.breath_attr === '8s',
  rest_not_active:         runtimeState?.active_attr === 'false',
  animate_child_present:   runtimeState?.animate_present === true,
  animate_dur_8s:          runtimeState?.animate_dur === '8s',
  animate_values_correct:  runtimeState?.animate_values === '0.78;1;0.78',
  animate_repeat_indef:    runtimeState?.animate_repeat === 'indefinite',
  tsx_breath_attr:         tsxBreathAttr,
  tsx_animate_element:     tsxAnimate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R700 recent-panel-title at-rest SVG breath (milestone — 4th respiratory rhythm in topo, 8s tier):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
