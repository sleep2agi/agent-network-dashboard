/* Round 72 verification: ring-layout first-paint stagger is tier-radial
 * (inner ring → outer ring → offline ring), instead of R9's pure
 * clockwise nodeIdx walk. Grid mode keeps R9 unchanged.
 *
 *  - Mount 20 sessions in ring layout → triple-tier (r1=145 / r2=215 /
 *    r3=285). data-tier-idx reflects 0/1/2 (offline=3).
 *  - For ring: every tier-2 node's animationDelay is >= every tier-0
 *    node's animationDelay (strict tier ordering).
 *  - For grid: every node has data-tier-idx="-1" and the delay falls
 *    on R9's `nodeIdx * 25` schedule (max 600ms tail).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(layout, count) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((layout) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', layout);
      sessionStorage.setItem('anet_v3_auth', '1');
      sessionStorage.removeItem('anet-topo-pinned-status');
      sessionStorage.removeItem('anet-topo-pinned-group');
    } catch {}
  }, layout);
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = Array.from({ length: count }).map((_, i) => ({
      alias: `n${i.toString().padStart(2, '0')}`,
      status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(c => document.querySelectorAll('g[data-node]').length === c, count, { timeout: 30000 });
  await page.waitForTimeout(600);
  const rows = await page.evaluate(() => {
    return [...document.querySelectorAll('g[data-node]')].map(g => ({
      alias: g.getAttribute('data-node'),
      tier:  g.getAttribute('data-tier-idx'),
      delay: g.style.animationDelay,
    }));
  });
  await ctx.close();
  return rows;
}

const ringRows = await probe('ring', 20);
const gridRows = await probe('grid', 6);

await browser.close();

const ms = (s) => parseFloat((s || '0ms').replace('ms', ''));
const tier0 = ringRows.filter(r => r.tier === '0').map(r => ms(r.delay));
const tier1 = ringRows.filter(r => r.tier === '1').map(r => ms(r.delay));
const tier2 = ringRows.filter(r => r.tier === '2').map(r => ms(r.delay));

const maxTier0 = Math.max(...(tier0.length ? tier0 : [0]));
const minTier1 = Math.min(...(tier1.length ? tier1 : [Infinity]));
const minTier2 = Math.min(...(tier2.length ? tier2 : [Infinity]));
const maxTier1 = Math.max(...(tier1.length ? tier1 : [0]));

const results = {
  ring_tier0_present: tier0.length > 0,
  ring_tier1_present: tier1.length > 0,
  ring_tier2_present: tier2.length > 0,
  ring_tier1_after_tier0: minTier1 > maxTier0,   // every t1 delay > every t0 delay
  ring_tier2_after_tier1: minTier2 > maxTier1,
  grid_allTierMinus1:    gridRows.every(r => r.tier === '-1'),
  grid_followsR9:        gridRows.every((r, i) => ms(r.delay) === Math.min(i, 24) * 25),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} tier stagger:`, JSON.stringify(results),
  `\n  ring tier0 delays=`, tier0,
  `\n  ring tier1 delays=`, tier1,
  `\n  ring tier2 delays=`, tier2,
  `\n  grid delays=`,       gridRows.map(r => r.delay));
process.exit(ok ? 0 : 1);
