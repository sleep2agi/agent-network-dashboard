/* Round 504 verification: root svg surfaces `data-topo-pinned-aspect`
 * categorical attribute. Sibling to R488's `data-topo-hovered-alias`
 * (hover identity); R504 is the pin axis identity. Reflects WHICH
 * pin state is active — paired with R467's any-pinned boolean.
 *
 * Tier values:
 *   none, status, group, vendor, edge, multi
 *
 * Test scenarios — seed pins via localStorage to reach each tier
 * deterministically.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe({ pins }) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((p) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'ring');
      sessionStorage.setItem('anet_v3_auth', '1');
      // Pins persist via sessionStorage (not localStorage) — verified
      // by grep of TopoGraph.tsx useState initializers at lines
      // 1033/1148/1187. pinnedEdgeKey starts null (no persistence;
      // edge pin only reachable via click, skipped in this test).
      if (p.status) sessionStorage.setItem('anet-topo-pinned-status', p.status);
      if (p.group)  sessionStorage.setItem('anet-topo-pinned-group',  p.group);
      if (p.vendor) sessionStorage.setItem('anet-topo-pinned-vendor', p.vendor);
    } catch {}
  }, pins);
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
      mk('alpha·1', 'working'),
      mk('alpha·2', 'idle'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('svg[data-topo-pinned-aspect]', { timeout: 15000 });
  await page.waitForTimeout(2800); // settle for localStorage-restore useEffect
  const aspect = await page.evaluate(() => {
    return document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-pinned-aspect');
  });
  await browser.close();
  return aspect;
}

const none   = await probe({ pins: {} });
const status = await probe({ pins: { status: 'working' } });
// Note: 'alpha' for group depends on actual alias-prefix derivation; valid
// because we seeded alpha·1 + alpha·2 (both have prefix 'alpha·')
const group  = await probe({ pins: { group: 'alpha·' } });
// vendor uses initial letter — Anthropic = 'A' (from vendorIdentity.ts line 69)
// claude-opus-4 model resolves to Anthropic vendor; stale-purge keeps 'A' valid
const vendor = await probe({ pins: { vendor: 'A' } });
// edge needs from→to format; skip — edge pin keys are complex
// Multi: status + group together
const multi  = await probe({ pins: { status: 'working', group: 'alpha·' } });

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /data-topo-pinned-aspect=\{\(\(\) => \{[\s\S]*?aspects\.push\('status'\)[\s\S]*?aspects\.push\('group'\)[\s\S]*?aspects\.push\('vendor'\)[\s\S]*?aspects\.push\('edge'\)/.test(src);

const results = {
  none_resolves:   none === 'none',
  status_resolves: status === 'status',
  group_resolves:  group === 'group',
  vendor_resolves: vendor === 'vendor',
  multi_resolves:  multi === 'multi',
  source_wired:    sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R504 pinned-aspect:`, JSON.stringify(results),
  '\n  raw:', { none, status, group, vendor, multi });
process.exit(ok ? 0 : 1);
