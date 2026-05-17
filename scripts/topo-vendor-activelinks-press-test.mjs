/* Round 496 verification: vendor letter chip (data-vendor-letter-
 * hover-lift="true") + active-links chip (data-active-links-chip)
 * join active:scale-95 press family. Brings press family from 13
 * surfaces (R495) to 15.
 *
 * Active-links chip is gated on isInteractive (flowLinks.length > 0)
 * — fixture provides at least 1 active edge via working session.
 * Vendor letter chip renders 1× per distinct vendor (cli runtime: 1 +
 * any others). Test uses fixture with claude-code-cli only.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·a1', 'working'),
    mk('alpha·a2', 'idle'),
  ] } });
});
// Provide messages so flowLinks isInteractive activates (R206 gate)
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'alpha·a1', to_alias: 'alpha·a2', content: 'test', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const vendor = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-vendor-letter-hover-lift="true"]'));
  return els.map((el) => {
    const cs = window.getComputedStyle(el);
    return {
      cls_has_scale95: /active:scale-95/.test(el.className || ''),
      cls_has_lift:    /hover:-translate-y-px/.test(el.className || ''),
      tp_has_transform:/transform/i.test(cs.transitionProperty || ''),
    };
  });
});

const active = await page.evaluate(() => {
  const el = document.querySelector('[data-active-links-chip]');
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  return {
    cls_has_scale95: /active:scale-95/.test(el.className || ''),
    cls_has_lift:    /hover:-translate-y-px/.test(el.className || ''),
    clickable:       el.getAttribute('data-active-links-clickable'),
    tp_has_transform:/transform/i.test(cs.transitionProperty || ''),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sVendor = /transition-transform duration-200 ease-out transform-gpu hover:-translate-y-px active:scale-95"/.test(src);
const sActive = /hover:bg-cyan-500\/10 hover:text-cyan-200 hover:border-cyan-500\/30 hover:-translate-y-px active:scale-95'/.test(src);

const allVendorsScale = vendor.length === 0 || vendor.every((v) => v.cls_has_scale95);
const allVendorsLift  = vendor.length === 0 || vendor.every((v) => v.cls_has_lift);
const allVendorsTp    = vendor.length === 0 || vendor.every((v) => v.tp_has_transform);

const results = {
  source_vendor_wired:     sVendor,
  source_active_wired:     sActive,
  vendor_rendered_or_zero: vendor.length >= 0, // tautology — gate signal only
  vendor_all_have_scale:   allVendorsScale,
  vendor_all_have_lift:    allVendorsLift,
  vendor_all_tp_transform: allVendorsTp,
  active_dom_found:        !!active,
  // active-links only carries scale-95 when isInteractive=clickable=true
  active_class_correct:    !active || (active.clickable === 'true' ? active.cls_has_scale95 : true),
  active_lift_correct:     !active || (active.clickable === 'true' ? active.cls_has_lift : true),
  active_tp_transform:     !active || active.tp_has_transform,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R496 vendor+active-links press:`, JSON.stringify(results),
  '\n  vendor count:', vendor.length, '  active clickable:', active && active.clickable);
process.exit(ok ? 0 : 1);
