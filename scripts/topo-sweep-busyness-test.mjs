/* Round 146 verification: R45 radar sweep rotation rate buckets on
 * workingCount, completing the 5-layer busyness-driven motion family:
 *
 *   R84  hub grounding-halo breath  — 4 / 3.2 / 2.7 / 2.4 s
 *   R131 outer-ring orbit period    — 16 / 14 / 12 / 10 s
 *   R132 groupbox marching ants     — 14 / 12 / 10 / 8 s  (grid only)
 *   R145 idle-spoke flow rate       — 2.8 / 2.4 / 2.0 / 1.6 s (ring only)
 *   R146 radar sweep rotation       — 8 / 6 / 4 / 3 s  (both layouts)
 *
 * Shared R84 thresholds (0 / 1-2 / 3-5 / 6+) drive every layer. The
 * sweep is the only layer visible in BOTH layouts and ties the family
 * together at the canvas-wide scope.
 *
 * R45 baseline 6s sits at bucket 1 — preserved when workingCount in
 * [1, 2] so existing demos and screenshots stay identical.
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
  await page.waitForSelector('.anet-topo-sweep', { timeout: 10000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const g = document.querySelector('.anet-topo-sweep');
    return {
      bucket: g?.getAttribute('data-topo-sweep-bucket'),
      dur:    g?.getAttribute('data-topo-sweep-dur'),
      cssDur: g ? getComputedStyle(g).getPropertyValue('animation-duration').trim() : null,
    };
  });
  await browser.close();
  return out;
}

const b0 = await probe(0, 4);  // 0 working → bucket 0 (8s)
const b1 = await probe(2, 4);  // 2 working → bucket 1 (6s, R45 baseline)
const b2 = await probe(4, 5);  // 4 working → bucket 2 (4s)
const b3 = await probe(7, 8);  // 7 working → bucket 3 (3s)

const consistent = (probe, bucket, dur) =>
  probe.bucket === String(bucket) && probe.dur === String(dur) && probe.cssDur === `${dur}s`;

const results = {
  b0_bucket0_8s:   consistent(b0, 0, 8),
  b1_bucket1_6s:   consistent(b1, 1, 6),
  b2_bucket2_4s:   consistent(b2, 2, 4),
  b3_bucket3_3s:   consistent(b3, 3, 3),
  // dur strictly decreases as busy climbs
  dur_monotonic:
    Number(b0.dur) > Number(b1.dur) &&
    Number(b1.dur) > Number(b2.dur) &&
    Number(b2.dur) > Number(b3.dur),
  // R45 baseline preservation: bucket 1 still 6s
  baseline_preserved: b1.dur === '6',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} sweep busyness:`, JSON.stringify(results),
  `\n  b0(0w/4)=`, b0,
  `\n  b1(2w/4)=`, b1,
  `\n  b2(4w/5)=`, b2,
  `\n  b3(7w/8)=`, b3);
process.exit(ok ? 0 : 1);
