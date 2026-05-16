/* Round 229 verification: group-label member-count tspan drops
 * its explicit fill (now inherits from parent <text>) and picks up
 * fontVariantNumeric: 'tabular-nums'.
 *
 * Two scopes:
 *   1) Hover-deepen-own-hue family — count chip color now follows
 *      parent name's R142 hover transition (legendText → legend-
 *      Headline). Tonal hierarchy (count < name brightness) is
 *      preserved across both rest AND hover instead of inverting
 *      on hover.
 *   2) Info-density tabular-nums — 5th surface after R224 edge
 *      badge / R225 hub + panel header + recent row.
 *
 * Scenario: 6 prefix-shared aliases (alpha-1..alpha-3, beta-1..
 * beta-3) → R106 cluster-by-prefix forms two groups, each with
 * count=3. Grid layout has explicit group label rendering (#111).
 *
 * Verifications:
 *   - data-group-label-count attr present (probe selector)
 *   - tspan has NO explicit fill attribute (inheriting)
 *   - getComputedStyle().fontVariantNumeric contains 'tabular-nums'
 *   - tspan computed fill matches PARENT <text> computed fill
 *     (R142 rest-state hierarchy preserved)
 *   - count text matches '· 3'
 *   - data-group-label-count-value reflects {box.count}
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // R226 grid layout — group labels render here. Storage key inferred
    // from data-topo-layout-toggle persistence pattern.
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha-1'), mk('alpha-2'), mk('alpha-3'),
    mk('beta-1'),  mk('beta-2'),  mk('beta-3'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForSelector('[data-group-label-count]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(400);

const out = await page.evaluate(() => {
  const counts = Array.from(document.querySelectorAll('[data-group-label-count]'));
  return counts.map((tspan) => {
    const parent = tspan.parentElement; // the <text data-group-label>
    return {
      key:            tspan.getAttribute('data-group-label-count'),
      countValue:     tspan.getAttribute('data-group-label-count-value'),
      hasFillAttr:    tspan.hasAttribute('fill'),
      text:           tspan.textContent,
      fontVarNumeric: getComputedStyle(tspan).fontVariantNumeric,
      tspanFill:      getComputedStyle(tspan).fill,
      parentFill:     parent ? getComputedStyle(parent).fill : null,
    };
  });
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');
const present = out.length > 0;

const results = {
  groups_found:           out.length === 2,
  all_have_key:           present && out.every(o => typeof o.key === 'string' && o.key.length > 0),
  all_count_3:            present && out.every(o => o.countValue === '3'),
  all_text_dot_3:         present && out.every(o => /·\s*3$/.test((o.text || '').trim())),
  all_no_fill_attr:       present && out.every(o => !o.hasFillAttr),
  all_tabular_nums:       present && out.every(o => hasTab(o.fontVarNumeric)),
  fill_inherits_parent:   present && out.every(o => o.tspanFill === o.parentFill),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-label count inherit + tabular:`, JSON.stringify(results),
  '\n  probed:', out);
process.exit(ok ? 0 : 1);
