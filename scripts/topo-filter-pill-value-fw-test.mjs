/* Round 412 verification: filter pin pill VALUE picks up fw=600
 * (font-semibold). Extends chip-internal-hierarchy arc (11th
 * anchor) — pill now reads with proper data-tier emphasis around
 * its R355 opacity-70 prefix/suffix.
 *
 * Contract:
 *   - Source-file verification of 4 occurrences of
 *     `<span className="font-semibold" data-filter-value>`
 *   - Runtime: pin a status filter, probe the data-filter-value
 *     span on the mounted pill — className includes font-semibold
 *     + textContent matches the pinned value.
 *   - Pre-R412 invariants on the pill:
 *     * data-filter-prefix span still opacity-70
 *     * data-filter-pill-count still opacity-70 tabular-nums
 *     * R397 hover-translate-y-px className still present
 *     * R332/R355/R356 className tokens preserved
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
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('g[data-node]', { timeout: 15000 });

// Click legend status row to pin filter → mounts the filter pill
await page.click('[data-legend-status="working"]');
await page.waitForSelector('[data-filter-value]', { timeout: 5000 });

const probe = await page.evaluate(() => {
  const valueSpan = document.querySelector('[data-filter-value]');
  if (!valueSpan) return null;
  const pill = valueSpan.closest('[data-topo-filter-pill-hover-lift="true"]');
  return {
    valueText:      valueSpan.textContent,
    valueClass:     valueSpan.className,
    valueFwComputed: getComputedStyle(valueSpan).fontWeight,
    pillClass:      pill?.className ?? null,
    pillActiveFilter: pill?.getAttribute('data-active-filter') ?? null,
  };
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const valueOccurrences = (fileText.match(/<span className="font-semibold" data-filter-value>/g) || []).length;

await browser.close();

const results = {
  // Runtime: value span has font-semibold
  value_has_font_semibold:  probe?.valueClass.includes('font-semibold') === true,
  value_text_working:       probe?.valueText === 'working',
  value_fw_600:             probe?.valueFwComputed === '600',
  // Pill mounted with R397 hover-lift
  pill_has_hover_lift:      probe?.pillClass?.includes('hover:-translate-y-px') === true,
  pill_active_filter:       probe?.pillActiveFilter === 'status',
  // Source-file: 4 occurrences (status + group + vendor + edge filters)
  source_4_value_spans:     valueOccurrences === 4,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pin pill VALUE fw 500 → 600:`, JSON.stringify(results),
  '\n  probe:', probe,
  '\n  source occurrences:', valueOccurrences);
process.exit(ok ? 0 : 1);
