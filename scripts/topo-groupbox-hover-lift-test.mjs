/* Round 142 verification: group boxes (R85+R68) gain a drop-
 * shadow lift on hover or pin, mirroring R135's overlay panel
 * hover-elevation. Closes the "interactive surface elevates"
 * vocabulary across canvas-side major surfaces:
 *   R18  KPI cards (Overview)
 *   R135 overlay panels (recent-signal + legend)
 *   R142 group boxes (canvas-level filter)
 *
 * Each carries a soft outward shadow when hovered/selected.
 *
 * States walked (grid layout, three prefix groups):
 *   1. Idle → all 3 boxes: data-group-box-lifted="false", no filter
 *   2. Hover infra label → infra lifted=true, filter set; others stay flat
 *   3. Leave hover → infra restored to flat
 *   4. Pin agents via CustomEvent → agents lifted=true (R63 pin path)
 *   5. Esc → agents back to flat
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1600, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // R85 group boxes only render in grid layout
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('agents-a1', 'working'), mk('agents-a2', 'idle'), mk('agents-a3', 'idle'),
    mk('infra-b1',  'working'), mk('infra-b2',  'idle'),
    mk('build-c1',  'idle'),    mk('build-c2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 7, { timeout: 30000 });
await page.waitForSelector('[data-group]', { timeout: 10000 });
await page.waitForTimeout(500);

const inspectAll = () => page.evaluate(() => {
  const boxes = [...document.querySelectorAll('rect[data-group-box-pinned]')];
  return boxes.map(rect => {
    const parentG = rect.closest('g[data-group]');
    return {
      group:   parentG?.getAttribute('data-group'),
      lifted:  rect.getAttribute('data-group-box-lifted'),
      filter:  rect.getAttribute('filter'),
      pinned:  rect.getAttribute('data-group-box-pinned'),
    };
  });
});

const state1 = await inspectAll();
const idleAll = state1.every(b => b.lifted === 'false' && !b.filter);

// Hover infra label
const infra = state1.find(b => (b.group || '').startsWith('infra'));
await page.locator(`[data-group-label-hit="${infra.group}"]`).first().hover({ timeout: 3000 });
await page.waitForTimeout(250);
const state2 = await inspectAll();
const infra2 = state2.find(b => b.group === infra.group);
const othersFlat2 = state2.filter(b => b.group !== infra.group).every(b => b.lifted === 'false' && !b.filter);

// Mouse away → restore
await page.mouse.move(20, 20);
await page.waitForTimeout(250);
const state3 = await inspectAll();
const infra3 = state3.find(b => b.group === infra.group);

// Pin agents via CustomEvent
const agents = state1.find(b => (b.group || '').startsWith('agents'));
await page.evaluate((key) => {
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'group', value: key } }));
}, agents.group);
await page.waitForTimeout(250);
const state4 = await inspectAll();
const agents4 = state4.find(b => b.group === agents.group);

// Esc clears pin
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const state5 = await inspectAll();
const agents5 = state5.find(b => b.group === agents.group);

await browser.close();

const liftFilter = 'url(#topo-groupbox-lift)';
const results = {
  s1_idleAllFlat:           idleAll,

  s2_infraLifted:           infra2?.lifted === 'true',
  s2_infraHasFilter:        infra2?.filter === liftFilter,
  s2_othersStillFlat:       othersFlat2,

  s3_infraRestored:         infra3?.lifted === 'false' && !infra3.filter,

  s4_agentsLifted:          agents4?.lifted === 'true',
  s4_agentsHasFilter:       agents4?.filter === liftFilter,
  s4_agentsPinnedAttr:      agents4?.pinned === 'true',

  s5_agentsCleared:         agents5?.lifted === 'false' && !agents5.filter,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} groupbox hover-lift:`, JSON.stringify(results),
  `\n  s1=`, state1,
  `\n  infra2=`, infra2, ` agents4=`, agents4, ` agents5=`, agents5);
process.exit(ok ? 0 : 1);
