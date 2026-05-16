/* Round 356 verification: filter pin pill × buttons gain hover:scale-
 * 110 (Tailwind 4 modern CSS `scale` property). Pre-R356 the × had
 * only hover:opacity-70 — target dimmed under cursor but didn't
 * lift. R356 adds a 10 % scale so the click-target reads as "press
 * me" alongside the dim. Sibling polish to R354 vendor letter glyph
 * + R350/R352/R353 chrome icon hover-scales. replace_all touched
 * all 4 filter pin pill × buttons (status / group / vendor / edge).
 *
 * Tailwind 4 compiles scale-110 to the modern CSS `scale` property
 * — probes getComputedStyle(el).scale (verified during R352).
 *
 * Contract (cyber, status filter pinned to 'working'):
 *   - Rest: × button computed scale 'none' (no scale applied).
 *   - Hover ×: scale === '1.1'.
 *   - Inline transition (computed) contains scale/transform.
 *   - Pre-R356 invariants: hover:opacity-70 still applies (button
 *     dims on hover), cursor: pointer, data-active-filter attr on
 *     parent pill still intact.
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
    localStorage.setItem('anet-pinnedStatus', JSON.stringify('working'));
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-working-chip]', { timeout: 15000 });
const pillVisible = await page.locator('[data-active-filter="status"]').count();
if (pillVisible === 0) {
  await page.click('[data-working-chip]');
  await page.waitForSelector('[data-active-filter="status"]', { timeout: 5000 });
}
await page.waitForTimeout(300);

const restProbe = await page.evaluate(() => {
  const pill = document.querySelector('[data-active-filter="status"]');
  const x = pill?.querySelector('button[aria-label^="Clear "]');
  const cs = x ? getComputedStyle(x) : null;
  return {
    scale:      cs?.scale ?? null,
    transition: cs?.transition ?? null,
    cursor:     cs?.cursor ?? null,
    className:  x?.getAttribute('class') ?? null,
    pillAttr:   pill?.getAttribute('data-active-filter') ?? null,
  };
});

await page.hover('[data-active-filter="status"] button[aria-label^="Clear "]');
await page.waitForTimeout(300);
const hoverProbe = await page.evaluate(() => {
  const x = document.querySelector('[data-active-filter="status"] button[aria-label^="Clear "]');
  return { scale: x ? getComputedStyle(x).scale : null };
});

await browser.close();

const isRestScale = (s) => s === 'none' || s === '1' || s === '1 1' || s === null;
const isHoverScale110 = (s) => s === '1.1' || s === '1.1 1.1';
const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  rest_scale_1:         isRestScale(restProbe.scale),
  trans_has_scale:      hasTrans(restProbe.transition, 'scale') || hasTrans(restProbe.transition, 'transform'),
  cursor_pointer:       restProbe.cursor === 'pointer',
  cls_has_hover_op_70:  /hover:opacity-70/.test(restProbe.className || ''),  // R343
  cls_has_hover_scale:  /hover:scale-110/.test(restProbe.className || ''),
  pill_attr_status:     restProbe.pillAttr === 'status',
  hover_scale_110:      isHoverScale110(hoverProbe.scale),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pill × hover-scale:`, JSON.stringify(results),
  '\n  rest:  ', restProbe,
  '\n  hover: ', hoverProbe);
process.exit(ok ? 0 : 1);
