/* Round 463 verification: topo-overlap-test.mjs grew a zombie-
 * build guard that consumes R462's svg[data-dashboard-version]
 * surface. Pre-R463 a stale next-server (dash zombie holding
 * cached chunks from an earlier preview) would let overlap-test
 * report fake green — bit us in R441 + R460. R463 closes that
 * by reading the DOM-side version and comparing to the package.
 * json version, failing fast with exit code 2 on mismatch.
 *
 * This test verifies:
 *   1. The augmented topo-overlap-test source contains the
 *      guard machinery (regex assertions on the actual file).
 *   2. The live dash agrees with package.json (sanity-check
 *      the current run state matches the guard's expectation).
 *   3. The guard sentinel path is wired in the caller (sentinel
 *      object with .stale === true triggers exit code 2).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const expected = JSON.parse(readFileSync('/home/vansin/agent-network-dashboard/package.json', 'utf8')).version;

const src = readFileSync('/home/vansin/agent-network-dashboard/scripts/topo-overlap-test.mjs', 'utf8');
const sourceHasGuardComment  = /Round 463.*zombie-build guard/.test(src);
const sourceHasLiveProbe     = /svg\.getAttribute\('data-dashboard-version'\)/.test(src);
const sourceHasMismatchBail  = /STALE BUILD/.test(src);
const sourceHasSentinelObj   = /\{ stale: true, live, expected \}/.test(src);
const sourceHasCallerCheck   = /typeof r === 'object' && r\.stale/.test(src);
const sourceHasExit2         = /process\.exit\(2\)/.test(src);

// Run a live probe to confirm the dash + pkg are aligned (we're in
// a clean state where the guard would PASS silently).
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 15000 });
const live = await page.evaluate(() =>
  document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-dashboard-version')
);
await browser.close();

const liveMatchesPkg = live === expected;

const results = {
  source_has_guard_comment:    sourceHasGuardComment,
  source_has_live_probe:       sourceHasLiveProbe,
  source_has_mismatch_bail:    sourceHasMismatchBail,
  source_has_sentinel_object:  sourceHasSentinelObj,
  source_has_caller_check:     sourceHasCallerCheck,
  source_has_exit_2:           sourceHasExit2,
  dash_live_matches_package:   liveMatchesPkg,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} overlap-test stale-build guard:`, JSON.stringify(results),
  '\n  expected pkg:', expected,
  '\n  live DOM:    ', live);
process.exit(ok ? 0 : 1);
