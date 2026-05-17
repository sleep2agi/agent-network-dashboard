/* Round 462 verification: TopoGraph root <svg> exposes the
 * shipped DASHBOARD_VERSION via data-dashboard-version attr.
 * Closes the feedback_dash_zombie_port_3000.md memory rule:
 * "verify ships via SVG DOM, not tmux 'Ready'" — pre-R462 there
 * was no in-DOM signal of which build the dash was serving.
 *
 * Contract:
 *   - svg[viewBox="0 0 1000 680"] reports data-dashboard-version
 *     matching package.json#version (a non-empty string that
 *     starts with a digit)
 *   - the dash is serving the EXPECTED preview (rejects zombie
 *     server scenarios where DOM and package.json disagree)
 *   - source-file conditional wired (import + attr presence)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const expected = JSON.parse(readFileSync('/home/vansin/agent-network-dashboard/package.json', 'utf8')).version;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return {
    attr: svg ? svg.getAttribute('data-dashboard-version') : null,
    hasSvg: !!svg,
  };
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasImport = /import \{ DASHBOARD_VERSION \} from '\.\.\/lib\/version'/.test(src);
const sourceHasAttr   = /data-dashboard-version=\{DASHBOARD_VERSION\}/.test(src);

await browser.close();

const attrPresent       = typeof probe.attr === 'string' && probe.attr.length > 0;
const attrIsVersionish  = attrPresent && /^\d/.test(probe.attr);
const attrMatchesPkg    = probe.attr === expected;

const results = {
  svg_present:           probe.hasSvg,
  attr_present:          attrPresent,
  attr_is_version_shape: attrIsVersionish,
  attr_matches_package:  attrMatchesPkg,
  source_import_wired:   sourceHasImport,
  source_attr_wired:     sourceHasAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} svg data-dashboard-version:`, JSON.stringify(results),
  '\n  expected:', expected,
  '\n  found:', probe.attr);
process.exit(ok ? 0 : 1);
