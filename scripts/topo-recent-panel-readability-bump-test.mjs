/* Round 259 verification: recent-signal panel's two italic instructional
 * texts bump fontSize 8 → 9 for readability.
 *
 * Pre-R259 size hierarchy in the recent-signal panel:
 *   "no flow yet"    main empty-state  fontSize 10 italic    (action prompt)
 *   row content      "alpha→beta · 3"  fontSize  9 regular   (data)
 *   hint             "send a message…" fontSize  8 italic    (instruction)
 *   "+N more flows"  footer link       fontSize  8 italic    (nav affordance)
 *   row timestamp    "5s"              fontSize  8 regular   (recency tag)
 *
 * Pre-R259 the hint + footer rendered at the smallest readable size on
 * canvas, italic + low opacity layering legibility cost on top of the
 * small type. Both are READ-TO-ACT text (instructional / clickable).
 *
 * Post-R259:
 *   hint        fontSize 8 → 9
 *   footer link fontSize 8 → 9
 *
 * The per-row timestamp STAYS at 8 — it's an at-a-glance recency tag
 * tightly co-located with row text, not read-to-act instruction. Hint +
 * footer at 9pt italic still subordinate to row content (9pt regular)
 * via italic + lower opacity discrimination.
 *
 * Test scope:
 *   1. Empty state hint fontSize === 9 (was 8). Tested in empty scenario.
 *   2. "+N more flows" footer fontSize === 9. Tested in 5-msg scenario.
 *   3. Per-row timestamp UNCHANGED at fontSize === 8 (sibling regression).
 *   4. R256 footer-breath invariant preserved — hover footer client
 *      bottom inside panel client bottom (footer with fontSize 9 still
 *      tucks inside the panel).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probeEmpty() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta')] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
  await page.waitForSelector('[data-recent-signal-empty-hint]', { timeout: 10000 });
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const hint = document.querySelector('[data-recent-signal-empty-hint]');
    return { hintFontSize: hint?.getAttribute('font-size') };
  });
  await ctx.close();
  return result;
}

async function probePopulated() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
      mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
    ] } });
  });
  // 5 distinct flow pairs → flowLinks.length === 5 → footer visible
  const now = Date.now();
  const msgs = [
    { id: 'm0', from_alias: 'alpha', to_alias: 'beta',  content: 'hi', network_id: 'default', created_at: new Date(now - 1000).toISOString() },
    { id: 'm1', from_alias: 'beta',  to_alias: 'gamma', content: 'hi', network_id: 'default', created_at: new Date(now - 1500).toISOString() },
    { id: 'm2', from_alias: 'gamma', to_alias: 'delta', content: 'hi', network_id: 'default', created_at: new Date(now - 2000).toISOString() },
    { id: 'm3', from_alias: 'delta', to_alias: 'alpha', content: 'hi', network_id: 'default', created_at: new Date(now - 2500).toISOString() },
    { id: 'm4', from_alias: 'alpha', to_alias: 'gamma', content: 'hi', network_id: 'default', created_at: new Date(now - 3000).toISOString() },
  ];
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-recent-panel-more-nav]', { timeout: 10000 });
  await page.waitForTimeout(500);

  const rest = await page.evaluate(() => {
    const footer = document.querySelector('[data-recent-panel-more]');
    const ts = document.querySelector('[data-recent-row-ts]');
    return {
      footerFontSize: footer?.getAttribute('font-size'),
      tsFontSize:     ts?.getAttribute('font-size'),
    };
  });

  // R256 invariant regression — hover the footer + check it tucks inside panel
  await page.locator('[data-recent-panel-more-nav]').hover();
  await page.waitForTimeout(250);
  const hoverProbe = await page.evaluate(() => {
    const panelG = document.querySelector('[data-topo-panel="recent"]');
    const rect   = panelG?.querySelector('rect');
    const footer = document.querySelector('[data-recent-panel-more]');
    return {
      rectBottom:   rect?.getBoundingClientRect().bottom   ?? null,
      footerBottom: footer?.getBoundingClientRect().bottom ?? null,
    };
  });
  await ctx.close();

  const hoverClearance = (hoverProbe.rectBottom != null && hoverProbe.footerBottom != null)
    ? (hoverProbe.rectBottom - hoverProbe.footerBottom) : null;

  return { ...rest, hoverClearance };
}

const empty = await probeEmpty();
const pop   = await probePopulated();
await browser.close();

const results = {
  hint_fontsize_bumped_to_9:        empty.hintFontSize === '9',
  footer_fontsize_bumped_to_9:      pop.footerFontSize === '9',
  per_row_timestamp_unchanged_at_8: pop.tsFontSize === '8',
  r256_footer_inside_panel_on_hover: pop.hoverClearance != null && pop.hoverClearance >= -1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent panel readability bump:`, JSON.stringify(results),
  '\n  empty:', empty,
  '\n  pop:',   pop);
process.exit(ok ? 0 : 1);
