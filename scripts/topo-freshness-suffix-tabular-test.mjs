/* Round 357 verification: active-links chip freshness suffix wrapper
 * picks up `tabular-nums` for digit width-lock. Pre-R357 the literal
 * "last {rel}" text (e.g. "last 5s ago", "last 10s ago") had
 * natural-figure digits — the ticker updates every second, so the
 * 9→10 boundary on seconds and 59s→1m flip both jittered ~1-2 px of
 * glyph width, propagating through the inline-flex chip row and
 * nudging the freshness DOT + chip's left edge. Tabular-nums on the
 * wrapper applies to all descendant digits (letters render at
 * natural widths). Joins the R224-R232 info-density tabular-nums
 * sweep at the chip-row freshness scope.
 *
 * Contract (cyber, fresh messages so the suffix renders):
 *   - Freshness wrapper element computed font-variant-numeric
 *     resolves to 'tabular-nums'.
 *   - data-active-links-freshness-wrapper attr present on the span.
 *   - The wrapper still carries text-gray-400 (R342) — invariant.
 *   - The freshness dot still has its color transition (R342) —
 *     invariant.
 *   - The active-links chip still mounts with the suffix child.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
// A fresh message so the active-links chip surfaces a suffix.
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-active-links-freshness-wrapper]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const wrap = document.querySelector('[data-active-links-freshness-wrapper]');
  const dot  = wrap?.querySelector('[data-active-links-freshness-dot]');
  const cs   = wrap ? getComputedStyle(wrap) : null;
  const dotCs = dot ? getComputedStyle(dot) : null;
  return {
    wrapperFontVariant: cs?.fontVariantNumeric ?? null,
    wrapperColor:       cs?.color ?? null,
    wrapperCls:         wrap?.getAttribute('class') ?? null,
    wrapperText:        wrap?.textContent ?? null,
    dotPresent:         !!dot,
    dotTransition:      dotCs?.transition ?? null,
    dotColor:           dotCs?.color ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  tabular_nums:        /tabular-nums/.test(probe.wrapperFontVariant || ''),
  cls_has_text_gray:   /text-gray-400/.test(probe.wrapperCls || ''),    // R342
  cls_has_tabular:     /tabular-nums/.test(probe.wrapperCls || ''),
  text_has_last:       /last/.test(probe.wrapperText || ''),
  dot_present:         probe.dotPresent,
  dot_has_color_trans: hasTrans(probe.dotTransition, 'color'),          // R342
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} freshness suffix tabular-nums:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
