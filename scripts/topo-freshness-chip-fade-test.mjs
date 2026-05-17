/* Round 505 verification: FreshnessChip mount picks up `anet-fade-in`
 * so the stale-warning amber pill eases in (opacity 0→1 over 150ms)
 * instead of popping into the chip-row. The chip ONLY renders when
 * stale (R275 conditional), so the fade plays exactly at the moment
 * the stale signal first arrives — perfectly aligned with semantic.
 *
 * Fixture: stale data is triggered when SWR sec > 10. The chip fetches
 * from /api/hub/status; we can route-mock with stale timestamps to
 * force the stale gate, but the simpler path is to assert the chip
 * IS NOT visible at rest (fresh data fixture) AND when it appears
 * post-stale, it carries the anet-fade-in class.
 *
 * Strategy:
 *   1. Source-side: regex confirms `${baseClass} ${colorClass} anet-
 *      fade-in` template literal + data-freshness-chip-mount-fade attr
 *      wired.
 *   2. DOM-side: probe page with no stale fixture; chip not visible.
 *      Then route-mock with stale lag (timestamps > 10s old) to force
 *      stale render; chip appears with anet-fade-in class + attr.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  // Stale fixture: served_at is FAR in past so client-side `sec` computes > 10
  // The FreshnessChip reads `sec` from SWR data freshness — but the chip
  // also computes from `served_at` (timestamp on the response). Let's mock
  // by holding the response so SWR's internal lastFetch timestamp ages.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    { alias: 'a·1', status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Force `sec` to compute as stale by mocking a stale state. Most reliable:
// look for the freshness chip element after waiting > 11s. But that's slow.
// Faster: just verify the FreshnessChip CAN be conditionally rendered with
// the right class — probe a synthetic case via direct DOM injection.
//
// Best simple test: source-side regex (the canonical proof) + assert that
// when the chip element EXISTS in the DOM (it would after stale onset),
// it carries the class. We'll trigger it by waiting + polling.

// Step 1: confirm chip is NOT visible at fresh-data start
const initialChip = await page.evaluate(() =>
  document.querySelector('[data-freshness-chip]')
);

// Step 2: Wait for stale threshold (sec > 10). FreshnessChip recalcs `sec`
// from `data.served_at` or SWR's last fetch timestamp every render — SWR
// refreshes every 5s, so the chip needs > 10s wall-clock since first fetch.
// Wait 13s.
await page.waitForTimeout(13000);
const chipInfo = await page.evaluate(() => {
  const chip = document.querySelector('[data-freshness-chip]');
  if (!chip) return null;
  return {
    present: true,
    class_has_fade: /anet-fade-in/.test(chip.getAttribute('class') || ''),
    mount_fade_attr: chip.getAttribute('data-freshness-chip-mount-fade'),
    stale_attr: chip.getAttribute('data-freshness-chip-stale'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceClassWired = /className=\{`\$\{baseClass\} \$\{colorClass\} anet-fade-in`\}/.test(src);
const sourceAttrWired  = /data-freshness-chip-mount-fade="true"/.test(src);

const results = {
  initial_chip_absent:   initialChip === null,
  source_class_wired:    sourceClassWired,
  source_attr_wired:     sourceAttrWired,
  // Post-stale assertions (vacuous-or-strict pattern banked from R495)
  post_stale_strict_or_vacuous:
    chipInfo === null ||
    (chipInfo.class_has_fade && chipInfo.mount_fade_attr === 'true' && chipInfo.stale_attr === 'true'),
  post_stale_chip_seen:  !!chipInfo,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R505 FreshnessChip mount fade:`, JSON.stringify(results),
  '\n  initial:', initialChip, '\n  post-stale:', JSON.stringify(chipInfo));
process.exit(ok ? 0 : 1);
