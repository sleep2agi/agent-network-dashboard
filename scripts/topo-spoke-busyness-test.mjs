/* Round 145 verification: R46 idle-spoke flow rate buckets on
 * workingCount, completing the 4-layer busyness-driven motion
 * family:
 *   R84  hub breath          (centre)
 *   R131 outer-ring orbit    (periphery)
 *   R132 groupbox march      (per-team, grid layout)
 *   R145 idle-spoke flow     (ring layout, hub→nodes) — new
 *
 * Bucket ladder shared across the four layers (same R84
 * thresholds):
 *   workingCount === 0     → bucket 0
 *   workingCount in [1, 2] → bucket 1
 *   workingCount in [3, 5] → bucket 2
 *   workingCount  >= 6     → bucket 3
 *
 * Idle-spoke durations per bucket: 2.8 / 2.4 / 2.0 / 1.6 seconds
 * (R46 baseline 2.4s is bucket 1).
 *
 * Spokes only render in ring layout. Active spokes (carrying flow
 * traffic) don't get the animation — they're solid bright strokes.
 * Only idle spokes carry the .anet-topo-spoke-flow class and the
 * --spoke-dur var. The test seeds 0 messages so all spokes are idle.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

async function probe(workingCount, totalCount) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      sessionStorage.setItem('anet_v3_auth', '1');
      // ring layout is R145's target — it's also the default, but
      // pinning explicitly defends against future default flips.
      localStorage.setItem('anet-topo-layout', 'ring');
    } catch {}
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
  // 0 messages → no active spokes → every spoke is idle (.anet-topo-spoke-flow)
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, totalCount, { timeout: 30000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const spokes = [...document.querySelectorAll('path.anet-topo-spoke-flow')];
    return spokes.map(p => ({
      bucket: p.getAttribute('data-topo-spoke-bucket'),
      dur:    p.getAttribute('data-topo-spoke-dur'),
      // Resolved animation-duration from computed style — confirms
      // the CSS var bridge through to the cascade.
      cssDur: getComputedStyle(p).getPropertyValue('animation-duration').trim(),
    }));
  });
  await browser.close();
  return out;
}

// One probe per bucket
const b0 = await probe(0, 4);  // 0 working / 4 idle  → bucket 0 (2.8s)
const b1 = await probe(2, 4);  // 2 working / 2 idle  → bucket 1 (2.4s)
const b2 = await probe(4, 5);  // 4 working / 1 idle  → bucket 2 (2.0s)
const b3 = await probe(7, 8);  // 7 working / 1 idle  → bucket 3 (1.6s)

const consistent = (spokes, bucket, dur) =>
  spokes.length > 0 &&
  spokes.every(s => s.bucket === String(bucket) && s.dur === String(dur) && s.cssDur === `${dur}s`);

const results = {
  b0_someSpokes:   b0.length > 0,
  b0_bucket0_2_8s: consistent(b0, 0, 2.8),
  b1_bucket1_2_4s: consistent(b1, 1, 2.4),
  b2_bucket2_2_0s: consistent(b2, 2, 2.0),
  b3_bucket3_1_6s: consistent(b3, 3, 1.6),
  // dur strictly decreases as busy climbs
  dur_monotonic:
    Number(b0[0]?.dur) > Number(b1[0]?.dur) &&
    Number(b1[0]?.dur) > Number(b2[0]?.dur) &&
    Number(b2[0]?.dur) > Number(b3[0]?.dur),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} spoke busyness:`, JSON.stringify(results),
  `\n  b0(0w/4)=`, b0.slice(0,1),
  `\n  b1(2w/4)=`, b1.slice(0,1),
  `\n  b2(4w/5)=`, b2.slice(0,1),
  `\n  b3(7w/8)=`, b3.slice(0,1));
process.exit(ok ? 0 : 1);
