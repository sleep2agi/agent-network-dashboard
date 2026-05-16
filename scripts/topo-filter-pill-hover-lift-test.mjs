/* Round 397 verification: filter pin pills gain hover lift
 * translateY(-1px). Sibling to R143 recent-row lift idiom —
 * extends the "rising on hover" gesture from SVG canvas surfaces
 * to the HTML filter chip strip. All 4 filter pill variants
 * (status / group / vendor / edge) carry the lift.
 *
 * Contract:
 *   - Source-file verification of the new className tokens
 *     (transition-transform + hover:-translate-y-px + transform-gpu)
 *   - The data-topo-filter-pill-hover-lift="true" sentinel attr
 *     is mounted when any filter pill is rendered (pinned filter
 *     present). Test mounts a status filter by clicking a status
 *     chip, then probes the resulting pill.
 *   - Pre-R397 invariants preserved on the pill className:
 *     * group / rounded-md / font-mono / font-medium / text-xs
 *       / border / anet-fade-in / anet-topo-chip-focus
 *
 * Note: hover dispatch on HTML chips in headless can fire but
 * computing the post-hover translate-y reliably requires a mouse
 * sweep. Test asserts the className tokens are present (which
 * is what Tailwind compiles into `:hover` CSS) plus the sentinel
 * attr — both deterministic from source.
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
    mk('gamma', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('g[data-node]', { timeout: 15000 });
await page.waitForTimeout(400);

// Click a legend status row to pin the status filter → mounts the
// filter pill. Use the alpha node since `working` row exists in fixture.
await page.click('[data-legend-status="working"]');
await page.waitForSelector('[data-topo-filter-pill-hover-lift="true"]', { timeout: 5000 });

const probe = await page.evaluate(() => {
  const pill = document.querySelector('[data-topo-filter-pill-hover-lift="true"]');
  return pill ? {
    className: pill.className,
    activeFilter: pill.getAttribute('data-active-filter'),
  } : null;
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const occurrences = (fileText.match(/hover:-translate-y-px/g) || []).length;
const sentinelOccurrences = (fileText.match(/data-topo-filter-pill-hover-lift="true"/g) || []).length;

await browser.close();

const cls = probe?.className || '';
const results = {
  // Sentinel attr mounted on the filter pill
  pill_mounted:             !!probe,
  // R397: hover-lift tokens present in className
  has_transition_transform: cls.includes('transition-transform'),
  has_hover_translate:      cls.includes('hover:-translate-y-px'),
  has_transform_gpu:        cls.includes('transform-gpu'),
  has_duration_200:         cls.includes('duration-200'),
  has_ease_out:             cls.includes('ease-out'),
  // Pre-R397 className tokens preserved
  has_rounded_md:           cls.includes('rounded-md'),
  has_font_mono:            cls.includes('font-mono'),
  has_anet_topo_chip_focus: cls.includes('anet-topo-chip-focus'),
  // Source-file replace_all coverage: 3 "group ..." pills + 1 plain pill = 4 occurrences
  source_4_pills_lifted:    occurrences === 4,
  source_4_sentinels:       sentinelOccurrences === 4,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pin pills hover lift translateY(-1px):`, JSON.stringify(results),
  '\n  className:', cls,
  '\n  activeFilter:', probe?.activeFilter,
  '\n  occurrences:', occurrences, '/ sentinels:', sentinelOccurrences);
process.exit(ok ? 0 : 1);
