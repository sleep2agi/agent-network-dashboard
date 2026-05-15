/* Round 84 verification: hub-halo breath amplitude + tempo reflect
 * `workingCount`. Buckets: 0 / 1-2 / 3-5 / 6+. An idle fleet keeps
 * the original 0.32→0.52 (light) / 0.08→0.16 (dark) cycle over 4s;
 * a busy fleet pulses faster with a higher peak. Pure visual breath
 * — geometry unchanged, overlap test untouched.
 *
 * Drive workingCount via mocked /api/hub/status sessions, then read
 * the SMIL `<animate>` attributes off the hub halo. The bucket gets
 * surfaced as `data-hub-busyness=0..3` for stable assertion without
 * parsing values strings.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const probe = async (workers) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
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
    for (let i = 0; i < workers; i++) {
      sessions.push({ alias: `wkr${i}`, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
        network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh });
    }
    sessions.push({ alias: 'idl', status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh });
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n,
    workers + 1, { timeout: 30000 });
  await page.waitForTimeout(400);

  const data = await page.evaluate(() => {
    const halo = document.querySelector('[data-hub-busyness]');
    const ani  = halo?.querySelector('animate');
    return {
      busy:    halo?.getAttribute('data-hub-busyness'),
      values:  ani?.getAttribute('values') || null,
      dur:     ani?.getAttribute('dur') || null,
    };
  });
  await ctx.close();
  return data;
};

// Helper: parse "trough;peak;trough" into [trough, peak].
const parseValues = (v) => v ? v.split(';').map(Number) : [];
const peakOf = (v) => Math.max(...parseValues(v));
const durOf  = (s) => s ? parseFloat(s.replace('s', '')) : 0;

const b0 = await probe(0);   // idle only
const b1 = await probe(1);   // 1 worker → bucket 1
const b2 = await probe(4);   // 4 workers → bucket 2
const b3 = await probe(7);   // 7 workers → bucket 3
await browser.close();

const results = {
  b0_bucket:        b0.busy === '0',
  b1_bucket:        b1.busy === '1',
  b2_bucket:        b2.busy === '2',
  b3_bucket:        b3.busy === '3',
  // Peak climbs with bucket — dark theme values.
  peak_monotonic:   peakOf(b0.values) < peakOf(b1.values) &&
                    peakOf(b1.values) < peakOf(b2.values) &&
                    peakOf(b2.values) < peakOf(b3.values),
  // Duration shortens with bucket.
  dur_monotonic:    durOf(b0.dur) > durOf(b1.dur) &&
                    durOf(b1.dur) > durOf(b2.dur) &&
                    durOf(b2.dur) > durOf(b3.dur),
  // Idle baseline preserved.
  b0_idleDur_4s:    durOf(b0.dur) === 4,
  // Busy cap respected.
  b3_capped_24s:    durOf(b3.dur) === 2.4,
  // All have the same trough (preserving the rest baseline).
  trough_constant:  parseValues(b0.values)[0] === parseValues(b3.values)[0],
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub busyness:`, JSON.stringify(results),
  `\n  b0=`, b0,
  `\n  b1=`, b1,
  `\n  b2=`, b2,
  `\n  b3=`, b3);
process.exit(ok ? 0 : 1);
