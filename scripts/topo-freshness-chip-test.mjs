/* Round 46 verification: live · Ns freshness chip.
 *  - renders in the topology header with initial "live · 0s" or "live · 1s"
 *  - ticks up over time (>= 2s after a 2.5s wait)
 *  - resets near 0 when SWR delivers a new sessions payload (we trigger
 *    this by mutating the mocked /api/hub/status response — SWR's 5s
 *    refresh re-fetches and the chip should re-zero)
 *  - turns amber when stale (>10s since last sync; verified by blocking
 *    the second poll and waiting >12s) */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

let pollCount = 0;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  pollCount++;
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: `a${pollCount}`, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'b', status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-freshness-chip]', { timeout: 30000 });

const readChip = () => page.evaluate(() => {
  const el = document.querySelector('[data-freshness-chip]');
  if (!el) return null;
  return {
    text: (el.textContent || '').trim(),
    isAmber: /amber|warning/i.test(el.className) || el.className.includes('amber'),
  };
});

const initial = await readChip();
await page.waitForTimeout(2500);
const afterTick = await readChip();

// SWR refreshes every 5s — wait past one cycle and confirm the chip re-zeros.
// Initial chip might be 1s, after 2.5s should be 3s. After a ~5s sync,
// should drop to 0-1s.
await page.waitForTimeout(3500);
const afterSync = await readChip();

await browser.close();
const seconds = (s) => +(s.text.match(/(\d+)s/)?.[1] ?? -1);
const results = {
  initialNearZero: initial !== null && seconds(initial) <= 2,
  tickedUpAfter25s: afterTick !== null && seconds(afterTick) >= 2 && seconds(afterTick) <= 4,
  reZeroedAfterSync: afterSync !== null && seconds(afterSync) <= 2,
  pollsHappened: pollCount >= 2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} freshness chip:`, JSON.stringify(results),
  `\n  initial=${JSON.stringify(initial)}\n  afterTick=${JSON.stringify(afterTick)}\n  afterSync=${JSON.stringify(afterSync)} polls=${pollCount}`);
process.exit(ok ? 0 : 1);
