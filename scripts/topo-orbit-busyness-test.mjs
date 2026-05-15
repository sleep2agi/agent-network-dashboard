/* Round 131 verification: outer-ring orbit period buckets on
 * workingCount, mirroring R84's hub-breath cadence. Idle fleet
 * keeps the original 16s "calm sweep"; as work piles up the
 * orbit accelerates to 14 / 12 / 10s. Both motion layers now
 * read the same underlying "is the network busy" signal.
 *
 * Bucket boundaries identical to R84 (line ~2702):
 *   workingCount === 0     → bucket 0, dur 16s
 *   workingCount in [1, 2] → bucket 1, dur 14s
 *   workingCount in [3, 5] → bucket 2, dur 12s
 *   workingCount  >= 6     → bucket 3, dur 10s
 *
 * R50 only renders on cyber theme (light is skipped to keep the
 * white surface clean). All probes use cyber.
 *
 * Probe fleet sizes pick one representative per bucket.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

async function probe(workingCount, totalCount) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = [];
    for (let i = 0; i < totalCount; i++) {
      sessions.push({
        alias: `node${i}`,
        status: i < workingCount ? 'working' : 'idle',
        model: 'claude-opus-4', runtime: 'cli-claude-code',
        network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: fresh,
      });
    }
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, totalCount, { timeout: 30000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const orbits = [...document.querySelectorAll('[data-topo-orbit-bucket]')];
    return orbits.map(g => ({
      bucket: g.getAttribute('data-topo-orbit-bucket'),
      dur:    g.getAttribute('data-topo-orbit-dur'),
      animDur: g.querySelector('animateTransform')?.getAttribute('dur'),
    }));
  });

  await browser.close();
  return out;
}

// Pick one from each bucket
const b0 = await probe(0, 4);  // workingCount=0  → bucket 0, dur 16
const b1 = await probe(2, 4);  // workingCount=2  → bucket 1, dur 14
const b2 = await probe(4, 5);  // workingCount=4  → bucket 2, dur 12
const b3 = await probe(7, 8);  // workingCount=7  → bucket 3, dur 10

const allConsistent = (orbits, bucket, dur) =>
  orbits.length === 4 &&
  orbits.every(o => o.bucket === String(bucket) && o.dur === String(dur) && o.animDur === `${dur}s`);

const results = {
  b0_fourOrbits:  b0.length === 4,
  b0_bucket0_16s: allConsistent(b0, 0, 16),
  b1_bucket1_14s: allConsistent(b1, 1, 14),
  b2_bucket2_12s: allConsistent(b2, 2, 12),
  b3_bucket3_10s: allConsistent(b3, 3, 10),
  // dur strictly decreases as busy increases
  dur_monotonic:
    Number(b0[0]?.dur) > Number(b1[0]?.dur) &&
    Number(b1[0]?.dur) > Number(b2[0]?.dur) &&
    Number(b2[0]?.dur) > Number(b3[0]?.dur),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} orbit busyness:`, JSON.stringify(results),
  `\n  b0(0w/4)=`, b0,
  `\n  b1(2w/4)=`, b1,
  `\n  b2(4w/5)=`, b2,
  `\n  b3(7w/8)=`, b3);
process.exit(ok ? 0 : 1);
