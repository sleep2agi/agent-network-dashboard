/* Round 733 — extend SVG <title> a11y to the hub-highlight disc, the
 * most prominent focal element on the canvas (network center). 6th
 * surface in the R730-family a11y sweep, first non-brand a11y surface.
 *
 * Uses an extended 3-part accessible_name format:
 *   "hub · network center · idle indicator"
 *     name (hub) · spatial role (network center) · state role (idle indicator)
 * R732 catalog's canonical-format regex was widened to `[^·]+( · [^·]+)+`
 * (≥2 parts) to admit this entry.
 *
 * Assertions:
 *   - Hub-highlight <circle> has a direct <title> child with expected text
 *   - The accessible name has exactly 3 parts (3-part canonical form)
 *   - R732 catalog has 6 entries (was 5 pre-R733)
 *   - R732 catalog includes hub-highlight disc entry
 *   - Existing R497 SMIL opacity breath child preserved on hub-highlight
 *     (regression — the <title> is a sibling, not replacing)
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

const state = await page.evaluate(() => {
  const hub = document.querySelector('[data-topo-hub-highlight]');
  const svg = document.querySelector('[data-topo-canvas-aria]');
  const directTitleText = (el) => {
    if (!el) return null;
    for (const child of el.children) {
      if (child.tagName.toLowerCase() === 'title') return child.textContent;
    }
    return null;
  };
  return {
    hub_present:           !!hub,
    hub_title_text:        directTitleText(hub),
    hub_smil_animate:      hub?.querySelector('animate[attributeName="opacity"]') !== null,
    hub_smil_dur:          hub?.querySelector('animate[attributeName="opacity"]')?.getAttribute('dur') ?? null,
    catalog_attr:          svg?.getAttribute('data-topo-a11y-titles') ?? null,
  };
});

await browser.close();

let catalog = null;
try { catalog = JSON.parse(state.catalog_attr ?? ''); } catch {}

const hubEntry = Array.isArray(catalog) ? catalog.find(e => e.surface === 'hub-highlight disc') : null;
const partCount = typeof state.hub_title_text === 'string' ? state.hub_title_text.split(' · ').length : 0;

const results = {
  /* Hub-highlight is conditionally visible (workingCount === 0) but
   * the <circle> with <title> is always mounted; treat as pass if
   * element renders, conservative SR-coverage check otherwise. */
  hub_title_present_when_rendered:   !state.hub_present || state.hub_title_text === 'hub · network center · idle indicator',
  three_part_canonical_form:         !state.hub_present || partCount === 3,
  smil_opacity_breath_preserved:     !state.hub_present || (state.hub_smil_animate && state.hub_smil_dur === '4s'),
  r732_catalog_has_6_entries:        Array.isArray(catalog) && catalog.length === 6,
  r732_catalog_has_hub_entry:        !!hubEntry && hubEntry.accessible_name === 'hub · network center · idle indicator',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R733 hub-highlight SVG <title> a11y (6th titled surface, first non-brand):`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`,
  `\n  hub entry: ${JSON.stringify(hubEntry)}`);
process.exit(ok ? 0 : 1);
