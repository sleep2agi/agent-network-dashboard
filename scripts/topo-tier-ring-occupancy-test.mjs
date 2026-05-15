/* Round 92 verification: tier-ring opacity reflects occupancy. R54
 * drew the guide rings at a fixed opacity regardless of how many
 * nodes lived on each tier. R92 buckets the count and scales
 * opacity, so a crowded tier shouts and an empty tier disappears.
 *
 * Probe three fleet sizes: small (4 → 1 ring), medium (12 → 2 rings),
 * large (18 → 3 rings). Assert bucket monotonicity (higher count =
 * higher bucket = higher opacity) and that each rendered ring carries
 * its occupancy + bucket data attributes.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const probe = async (count) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
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
    const sessions = [];
    for (let i = 0; i < count; i++) {
      sessions.push({ alias: `n${i}`, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
        network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh });
    }
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n,
    count, { timeout: 30000 });
  await page.waitForTimeout(500);

  const rings = await page.evaluate(() => {
    return [...document.querySelectorAll('[data-tier-ring]')].map(r => ({
      radius:    r.getAttribute('data-tier-ring'),
      occupancy: r.getAttribute('data-tier-occupancy'),
      bucket:    r.getAttribute('data-tier-bucket'),
      opacity:   +(r.getAttribute('opacity') || '0'),
    })).sort((a, b) => +a.radius - +b.radius);
  });
  await ctx.close();
  return rings;
};

const small  = await probe(4);    // 4 nodes → 1 ring, occupancy 4, bucket 1 (3-6)
const medium = await probe(12);   // 12 nodes → 2 rings
const large  = await probe(18);   // 18 nodes → 3 rings
await browser.close();

const occupancySum = (rings) => rings.reduce((acc, r) => acc + +r.occupancy, 0);

const results = {
  small_oneRing:        small.length === 1,
  small_occupancy4:     small[0]?.occupancy === '4',
  small_bucket1:        small[0]?.bucket === '1',
  medium_twoRings:      medium.length === 2,
  medium_occupancyMatchesFleet: occupancySum(medium) === 12,
  large_threeRings:     large.length === 3,
  large_occupancyMatchesFleet:  occupancySum(large) === 18,
  // Higher bucket → higher opacity (monotonic ladder).
  bucketLadder_monotonic: large.every(r => {
    const b = +r.bucket;
    // dark theme: bucket 0 → 0.32, 1 → 0.46, 2 → 0.62
    const expected = [0.32, 0.46, 0.62][b];
    return Math.abs(r.opacity - expected) < 0.01;
  }),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} tier-ring occupancy:`, JSON.stringify(results),
  `\n  small (4)=`,  small,
  `\n  medium (12)=`, medium,
  `\n  large (18)=`,  large);
process.exit(ok ? 0 : 1);
