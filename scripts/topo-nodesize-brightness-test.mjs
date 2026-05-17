/* Round 598 verification: nodeSize S/M/L segmented buttons gain
 * hover:brightness-[1.15]. 39+40+41st anchors (8+9+10th HTML).
 * 3-anchor sibling edit closing the FINAL segmented chrome
 * control at brightness parity (R596 zoom + R597 layout +
 * R598 nodeSize = full segmented coverage 8/8 buttons).
 *
 * Test phases:
 *   1. mock nodes → chrome strip renders S + M + L buttons
 *   2. rest: filter='none', brightness-hover-attr='1.15' on all 3
 *   3. computed transition-property contains 'filter' on all 3
 *   4. source: hover:brightness-[1.15] + arbitrary
 *      [transition-property:...,filter] in className
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
await page.waitForSelector('[data-topo-chrome-nodesize="S"]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const els = ['S','M','L'].map(k => document.querySelector(`[data-topo-chrome-nodesize="${k}"]`));
  if (els.some(e => !e)) return null;
  return els.map(el => ({
    key: el.getAttribute('data-topo-chrome-nodesize'),
    filter: getComputedStyle(el).filter,
    transitionProperty: getComputedStyle(el).transitionProperty,
    brightnessHoverAttr: el.getAttribute('data-topo-chrome-nodesize-brightness-hover'),
    textContent: el.textContent,
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /hover:brightness-\[1\.15\][^"]*\}\$\{idx > 0 \? 'border-l'/.test(src) ||
                     /hover:brightness-\[1\.15\]/.test(src.split('data-topo-chrome-nodesize=\\{lbl\\}')[1] || src);
const sourceTransition = /\[transition-property:color,background-color,transform,font-weight,filter\]/.test(src);
const sourceAttr = /data-topo-chrome-nodesize-brightness-hover="1\.15"/.test(src);

const results = {
  all_three_present:      !!rest && rest.length === 3,
  rest_filter_all_none:   !!rest && rest.every(r => r.filter === 'none'),
  hover_attr_all_115:     !!rest && rest.every(r => r.brightnessHoverAttr === '1.15'),
  labels_S_M_L:           !!rest && rest.map(r => r.textContent).join('') === 'SML',
  transition_all_filter:  !!rest && rest.every(r => /filter/.test(r.transitionProperty || '')),
  source_filter_class:    /hover:brightness-\[1\.15\]/.test(src),
  source_transition:      sourceTransition,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R598 nodeSize S/M/L brightness (39+40+41st anchors, all-segmented-closed):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
