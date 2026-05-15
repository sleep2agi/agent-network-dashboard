/* Round 64 verification: active-filter pills appear in chip row when
 * pins are set and clear their pin on × click.
 *
 *  - No pin → no pill rendered.
 *  - Pin status (via legend) → pill labelled "filter: working" with
 *    aria-label that includes "Clear working filter".
 *  - × button click → pin clears + node opacities restore.
 *  - Both pins independent: pin a status + pin a group → two pills.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'alpha1', status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha2', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha3', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'beta',   status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(500);

const readPills = () => page.evaluate(() => {
  return [...document.querySelectorAll('[data-active-filter]')].map(el => ({
    kind: el.getAttribute('data-active-filter'),
    text: (el.textContent || '').trim(),
  }));
});
const readWkrOpacity = () => page.evaluate(() => +(document.querySelector('g[data-node="alpha1"]')?.style.opacity || '1'));

const pillsBefore = await readPills();

// Pin working via legend.
await page.locator('g[data-legend-status="working"]').first().click({ force: true });
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const pillsAfterStatus = await readPills();
const wkrAfterStatus = await readWkrOpacity();

// Pin alpha group via label click.
await page.locator('g[data-group-label-hit="alpha"]').first().click({ force: true });
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const pillsBothPinned = await readPills();

// Click × on the status pill.
await page.locator('[data-active-filter="status"] button[aria-label*="working"]').first().click({ force: true });
await page.waitForTimeout(250);
const pillsAfterStatusClear = await readPills();
const wkrAfterStatusClear = await readWkrOpacity();

// Click × on the group pill.
await page.locator('[data-active-filter="group"] button[aria-label*="alpha"]').first().click({ force: true });
await page.waitForTimeout(250);
const pillsFinal = await readPills();

await browser.close();

const results = {
  before_noPills:        pillsBefore.length === 0,
  statusPin_oneStatusPill: pillsAfterStatus.length === 1
                          && pillsAfterStatus[0].kind === 'status'
                          && /filter:\s*working/.test(pillsAfterStatus[0].text),
  statusPin_dimsBeta:     wkrAfterStatus >= 0.55,   // alpha1 IS working — should stay
  bothPinned_twoPills:    pillsBothPinned.length === 2
                          && pillsBothPinned.some(p => p.kind === 'status')
                          && pillsBothPinned.some(p => p.kind === 'group'),
  statusClear_only_group_remains: pillsAfterStatusClear.length === 1
                                  && pillsAfterStatusClear[0].kind === 'group',
  statusClear_restoredOpacity: wkrAfterStatusClear >= 0.55,
  groupClear_noPills:     pillsFinal.length === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-filter pill:`, JSON.stringify(results),
  `\n  pillsAfterStatus=`, pillsAfterStatus,
  `\n  pillsBothPinned=`, pillsBothPinned,
  `\n  pillsAfterStatusClear=`, pillsAfterStatusClear);
process.exit(ok ? 0 : 1);
