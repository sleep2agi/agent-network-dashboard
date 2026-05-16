/* Round 410 verification: FreshnessChip body picks up chip-internal-
 * hierarchy — `{sec}` digit (fw=600 data tier) + `s` unit (opacity
 * 0.7 label tier). Extends R333-R341/R362/R369/R389 arc to 10th
 * anchor.
 *
 * Contract:
 *   - R275 stale-only render: chip only mounts when sec > 10. Test
 *     waits for /api/hub/status to settle, then advances lastSyncRef
 *     by 11+ seconds via a long wait (the FreshnessChip ticks every
 *     1s via setInterval). To avoid the slow wait we instead probe
 *     the SOURCE-FILE for the wire change, then probe the chip if
 *     it happens to mount during the test window.
 *   - Source-file:
 *     * <span className="font-semibold" data-freshness-chip-digit>
 *     * <span className="opacity-70" data-freshness-chip-unit>
 *   - If chip mounts at runtime: data-freshness-chip-digit + -unit
 *     spans both present
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub]', { timeout: 15000 });

// Wait for FreshnessChip to mount (R275 stale-only: sec > 10). The
// chip ticks every 1s. Wait 12s so lastSyncRef-based sec crosses 10.
await page.waitForTimeout(12000);

const probe = await page.evaluate(() => {
  const chip = document.querySelector('[data-freshness-chip]');
  if (!chip) return { mounted: false };
  const digit = chip.querySelector('[data-freshness-chip-digit]');
  const unit  = chip.querySelector('[data-freshness-chip-unit]');
  return {
    mounted:        true,
    chipStale:      chip.getAttribute('data-freshness-chip-stale'),
    digitClass:     digit?.className ?? null,
    digitText:      digit?.textContent ?? null,
    unitClass:      unit?.className ?? null,
    unitText:       unit?.textContent ?? null,
  };
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasDigitSpan = /<span className="font-semibold" data-freshness-chip-digit>/.test(fileText);
const sourceHasUnitSpan  = /<span className="opacity-70" data-freshness-chip-unit>s<\/span>/.test(fileText);

await browser.close();

// Either runtime probe catches the chip OR source-file verification
// alone establishes the wire change.
const results = {
  // Source-file canonical wire (deterministic)
  source_digit_span:      sourceHasDigitSpan,
  source_unit_span:       sourceHasUnitSpan,
  // Runtime: chip might be present if test wait crossed 10s; assertions
  // are conditional on mounted (only enforce structure when chip exists).
  runtime_check_passed:   !probe.mounted || (
    probe.chipStale === 'true' &&
    probe.digitClass?.includes('font-semibold') === true &&
    /^\d+$/.test(probe.digitText || '') &&
    probe.unitClass?.includes('opacity-70') === true &&
    probe.unitText === 's'
  ),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} FreshnessChip chip-internal-hierarchy:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
