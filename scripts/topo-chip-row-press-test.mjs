/* Round 494 verification: chip-row working + online chips gain
 * `active:scale-95` press feedback, gated on the clickable branch
 * (workingCount > 0 / onlineNodes.length > 0). Extends the chrome-
 * strip press family (R492 Ring/Grid + R493 5 chrome buttons) into
 * the chip-row scope.
 *
 * Verifies per chip:
 *  - DOM element resolvable (data-working-chip / data-online-chip)
 *  - className contains `active:scale-95` (since fixture has both chips
 *    with > 0 count → clickable branch active)
 *  - computed transition-property includes `transform`
 *  - source-file regex confirms class string wired
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Need both working and online > 0 so both chip variants enter clickable branch
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·a1', 'working'),
    mk('alpha·a2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-working-chip]', { timeout: 15000 });
await page.waitForTimeout(1000);

const probe = async (sel) => {
  return await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return {
      cls: el.className || '',
      cls_has_scale95: /active:scale-95/.test(el.className || ''),
      cls_has_translate: /hover:-translate-y-px/.test(el.className || ''),
      tp: cs.transitionProperty,
      td: cs.transitionDuration,
      tp_has_transform: /transform/i.test(cs.transitionProperty || ''),
    };
  }, sel);
};

const wInfo = await probe('[data-working-chip]');
const oInfo = await probe('[data-online-chip]');

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sWorking = /workingCount > 0\s*\?\s*'bg-green-500\/10 text-green-300 border-green-500\/20 hover:bg-green-500\/15 hover:border-green-500\/30 hover:-translate-y-px active:scale-95'/.test(src);
const sOnline  = /onlineNodes\.length > 0\s*\?\s*'bg-cyan-500\/10 text-cyan-300 border-cyan-500\/20 hover:bg-cyan-500\/15 hover:border-cyan-500\/30 hover:-translate-y-px active:scale-95'/.test(src);

const results = {
  working_dom_found:    !!wInfo,
  working_has_scale95:  wInfo && wInfo.cls_has_scale95,
  working_has_lift:     wInfo && wInfo.cls_has_translate,
  working_tp_transform: wInfo && wInfo.tp_has_transform,
  online_dom_found:     !!oInfo,
  online_has_scale95:   oInfo && oInfo.cls_has_scale95,
  online_has_lift:      oInfo && oInfo.cls_has_translate,
  online_tp_transform:  oInfo && oInfo.tp_has_transform,
  source_working_wired: sWorking,
  source_online_wired:  sOnline,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip-row working+online active:scale-95 (R494):`, JSON.stringify(results),
  '\n  working tp:', wInfo && wInfo.tp,
  '\n  online  tp:', oInfo && oInfo.tp);
process.exit(ok ? 0 : 1);
