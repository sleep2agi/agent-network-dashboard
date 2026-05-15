/* Round 66 verification: pinnedStatus + pinnedGroup persist across page
 * reloads via sessionStorage. Stale group pins (group no longer exists)
 * are cleared on hydration so the chip row doesn't show a phantom team.
 *
 *  - Pre-seed sessionStorage with anet-topo-pinned-status='working' →
 *    reload → assert filter pill renders + working stays bright + idles
 *    dim. (Status pin survives.)
 *  - Pre-seed anet-topo-pinned-group='alpha' WITH alpha sessions → reload
 *    → pill renders + alpha team stays bright.
 *  - Pre-seed anet-topo-pinned-group='ghost' WITHOUT any ghost session →
 *    reload → the stale pin is cleared on hydration; no pill renders.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe({ status = null, group = null, sessions }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(({ status, group }) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'grid');
      sessionStorage.setItem('anet_v3_auth', '1');
      if (status) sessionStorage.setItem('anet-topo-pinned-status', status);
      else        sessionStorage.removeItem('anet-topo-pinned-status');
      if (group)  sessionStorage.setItem('anet-topo-pinned-group', group);
      else        sessionStorage.removeItem('anet-topo-pinned-group');
    } catch {}
  }, { status, group });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const seeded = sessions.map(s => ({
      alias: s.alias, status: s.status, network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions: seeded } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(c => document.querySelectorAll('g[data-node]').length === c, sessions.length, { timeout: 30000 });
  await page.waitForTimeout(700);
  const result = await page.evaluate(() => {
    const pills = [...document.querySelectorAll('[data-active-filter]')].map(el => ({
      kind: el.getAttribute('data-active-filter'),
      text: (el.textContent || '').trim(),
    }));
    const opacities = {};
    for (const el of document.querySelectorAll('g[data-node]')) {
      const a = el.getAttribute('data-node');
      if (a) opacities[a] = +(el.style.opacity || '1');
    }
    const storage = {
      status: sessionStorage.getItem('anet-topo-pinned-status'),
      group:  sessionStorage.getItem('anet-topo-pinned-group'),
    };
    return { pills, opacities, storage };
  });
  await ctx.close();
  return result;
}

const sessions3 = [
  { alias: 'alpha1', status: 'working' },
  { alias: 'alpha2', status: 'idle' },
  { alias: 'beta',   status: 'idle' },
];
const alphaPlus = [
  { alias: 'alpha1', status: 'idle' },
  { alias: 'alpha2', status: 'idle' },
  { alias: 'alpha3', status: 'idle' },
  { alias: 'beta',   status: 'idle' },
];

const statusRestore = await probe({ status: 'working', sessions: sessions3 });
const groupRestore  = await probe({ group: 'alpha',   sessions: alphaPlus });
const stalePin      = await probe({ group: 'ghost',   sessions: sessions3 });

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  statusPill_restored: statusRestore.pills.length === 1 && statusRestore.pills[0].kind === 'status'
                        && /filter:\s*working/.test(statusRestore.pills[0].text),
  statusPin_dimsIdle:  bright(statusRestore.opacities.alpha1) && dim(statusRestore.opacities.alpha2),
  groupPill_restored:  groupRestore.pills.length === 1 && groupRestore.pills[0].kind === 'group'
                        && /filter:\s*alpha/.test(groupRestore.pills[0].text),
  groupPin_dimsOutsider: bright(groupRestore.opacities.alpha1) && dim(groupRestore.opacities.beta),
  stale_pillCleared:   stalePin.pills.length === 0,
  stale_storageCleared: stalePin.storage.group === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pin persistence:`, JSON.stringify(results),
  `\n  statusRestore=`, statusRestore,
  `\n  groupRestore=`, groupRestore,
  `\n  stalePin=`, stalePin);
process.exit(ok ? 0 : 1);
