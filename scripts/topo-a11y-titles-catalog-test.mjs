/* Round 732 — a11y titles catalog on canvas root. 7TH orthogonal
 * meta-doc axis. The introspection layer crosses families:
 *
 *   Breath family (6 meta-docs):
 *     R710 data-topo-respiratory-rolodex              (cadences)
 *     R716 data-topo-respiratory-dual-axis-surfaces   (axes)
 *     R717 data-topo-respiratory-patterns             (patterns)
 *     R720 data-topo-respiratory-tiers                (tiers)
 *     R723 data-topo-respiratory-triple-axis-surfaces (triple-axis)
 *     R729 data-topo-respiratory-axis-count-stats     (stats)
 *
 *   A11y sub-family (1 meta-doc):
 *     R732 data-topo-a11y-titles                      (accessible names) ← this round
 *
 * Each entry maps surface → DOM selector → accessible name. The test
 * resolves each selector at runtime and verifies the element's direct
 * <title> child textContent matches the catalog's accessible_name.
 *
 * Assertions:
 *   - attr present on root <svg>
 *   - JSON parses to Array of 5 entries (R730: 3, R731: 2)
 *   - Each entry has {surface, selector, accessible_name} shape with
 *     non-empty string values
 *   - Each accessible_name follows canonical "<name> · <role>" format
 *   - Each selector resolves at runtime to an element (or null IF
 *     conditionally rendered, treated as pass for the cross-check)
 *   - When element exists, its direct <title> child's textContent
 *     equals catalog's accessible_name (STRICT cross-check)
 *   - All 5 surfaces are present in the expected anchor set
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
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-canvas-aria]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const result = await page.evaluate(() => {
  const svg = document.querySelector('[data-topo-canvas-aria]');
  const catalogAttr = svg?.getAttribute('data-topo-a11y-titles') ?? null;
  let catalog = null;
  try { catalog = JSON.parse(catalogAttr ?? ''); } catch {}

  /* Direct child <title> only — skip nested titles in mask defs etc. */
  const directTitleText = (el) => {
    if (!el) return null;
    for (const child of el.children) {
      if (child.tagName.toLowerCase() === 'title') return child.textContent;
    }
    return null;
  };

  const crossChecks = Array.isArray(catalog)
    ? catalog.map(entry => {
        const el = document.querySelector(entry.selector);
        return {
          surface: entry.surface,
          element_present: !!el,
          actual_title: directTitleText(el),
          matches: !el || directTitleText(el) === entry.accessible_name,
        };
      })
    : [];

  return { catalogAttr, catalog, crossChecks };
});

await browser.close();

const { catalog, crossChecks } = result;

const validShape = Array.isArray(catalog) && catalog.every(e =>
  typeof e?.surface === 'string' && e.surface.length > 0
  && typeof e?.selector === 'string' && e.selector.length > 0
  && typeof e?.accessible_name === 'string' && e.accessible_name.length > 0
);

const canonicalFormat = (s) => typeof s === 'string' && /^[^·]+ · [^·]+$/.test(s);
const allCanonical = Array.isArray(catalog) && catalog.every(e => canonicalFormat(e.accessible_name));

const expectedSurfaces = ['canvas-corner crescent', 'legend panel title', 'recent panel title', 'title-block brand logo', 'watermark text'];
const actualSurfaces = Array.isArray(catalog) ? catalog.map(e => e.surface).sort() : [];
const surfacesMatch = JSON.stringify(actualSurfaces) === JSON.stringify(expectedSurfaces);

const allCrossChecks = crossChecks.every(c => c.matches);

const results = {
  attr_present:                       !!result.catalogAttr,
  json_parses:                        catalog !== null,
  is_array:                           Array.isArray(catalog),
  has_5_entries:                      Array.isArray(catalog) && catalog.length === 5,
  shape_valid:                        validShape,
  all_accessible_names_canonical:     allCanonical,
  surfaces_match_expected_set:        surfacesMatch,
  all_cross_checks_pass:              allCrossChecks,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R732 a11y titles catalog (7th meta-doc — pentagon→hexagon→HEPTAGON, cross-family):`,
  JSON.stringify(results, null, 2),
  `\n  catalog: ${JSON.stringify(catalog)}`,
  `\n  cross-checks: ${JSON.stringify(crossChecks)}`);
process.exit(ok ? 0 : 1);
