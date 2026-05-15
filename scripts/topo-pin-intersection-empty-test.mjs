/* Round 125 verification: pin-intersection chip warning tint when
 * the intersection is zero.
 *
 * R124 added the "match: N pins · K" chip after the last filter
 * pill, gated to ≥ 2 active pin dims. It stayed neutral gray
 * regardless of whether K was 12 or 0 — but K=0 means "your pins
 * cancel out" and the canvas dims to 0.28 everywhere with no
 * positive signal. The neutral "· 0" tail reads as just another
 * number, indistinguishable from "· 12".
 *
 * R125 flips the chip to amber + adds a ⚠ glyph when K=0. Tooltip
 * grows the "release one to widen" hint. Color choice: amber
 * (#d97706 light / #fbbf24 dark) — distinct from every pill color
 * AND from the gray non-empty intersection state.
 *
 * Fleet:
 *   alpha (working, vendor=A)
 *   beta  (working, vendor=O)
 *   gamma (idle,    vendor=A)
 *   delta (idle,    vendor=O)
 *
 * Path:
 *   1. Pin status=working                          → chip hidden (1 pin)
 *   2. + Pin vendor=A → intersection {alpha} = 1   → chip gray, no ⚠
 *   3. Esc, then pin status=offline + vendor=A     → intersection 0
 *      (alpha+gamma have vendor=A but neither is offline)
 *      → chip amber + ⚠ glyph + tooltip mentions "release one to widen"
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, model) => ({
    alias, status, model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working', 'claude-opus-4'),
    mk('beta',  'working', 'gpt-4o'),
    mk('gamma', 'idle',    'claude-sonnet-4'),
    mk('delta', 'idle',    'gpt-4o-mini'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const readChip = () => page.evaluate(() => {
  const el = document.querySelector('[data-pin-intersection]');
  if (!el) return null;
  // background color comes from inline style; parse for amber substring.
  const inline = el.getAttribute('style') || '';
  return {
    dimCount:  parseInt(el.getAttribute('data-pin-dim-count') || '0', 10),
    matchCount: parseInt(el.getAttribute('data-pin-intersection-count') || '0', 10),
    empty: el.getAttribute('data-pin-intersection-empty'),
    text: el.textContent?.trim(),
    title: el.getAttribute('title'),
    // Browser normalises inline hex → rgb() when reading via
    // getAttribute('style'). Cyber theme: #fbbf24 → rgb(251, 191, 36);
    // gray #94a3b8 → rgb(148, 163, 184). Light theme would emit
    // rgb(217, 119, 6) and rgb(71, 85, 105) — accept both.
    // Inline background uses rgba(...) because of the alpha suffix
    // we pass; foreground color is rgb(...). Match both with rgba?.
    styleHasAmber: /rgba?\(251,\s*191,\s*36/i.test(inline) || /rgba?\(217,\s*119,\s*6/i.test(inline),
    styleHasGray:  /rgba?\(148,\s*163,\s*184/i.test(inline) || /rgba?\(71,\s*85,\s*105/i.test(inline),
  };
});

// All four sessions are online in this fleet, so the offline
// pressure-seg doesn't render. Use the R69 CustomEvent contract
// to drive pins — same handler at line 920+ of TopoGraph.tsx.
const pin = (detail) => page.evaluate(d => {
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: d }));
}, detail);

// State 1 — only status pinned
await pin({ kind: 'status', value: 'working' });
await page.waitForTimeout(200);
const s1 = await readChip();

// State 2 — + vendor=A (working ∩ A = {alpha}) → 1 match, gray
await pin({ kind: 'vendor', value: 'A' });
await page.waitForTimeout(200);
const s2 = await readChip();

// Esc, then pin status=offline + vendor=A → 0 matches (alpha/gamma are
// A but online; beta/delta are O). Empty intersection → amber + ⚠.
await pin({ kind: 'clear' });
await page.waitForTimeout(200);
await pin({ kind: 'status', value: 'offline' });
await pin({ kind: 'vendor', value: 'A' });
await page.waitForTimeout(200);
const s3 = await readChip();

await browser.close();

const results = {
  s1_onePin_chipHidden:        s1 === null,
  s2_twoPins_chipShown:        !!s2 && s2.dimCount === 2 && s2.matchCount === 1,
  s2_nonEmpty_grayBg:          !!s2 && s2.empty === 'false' && s2.styleHasGray && !s2.styleHasAmber,
  s2_noWarnGlyph:              !!s2 && !s2.text?.includes('⚠'),
  s3_twoPins_zeroMatch:        !!s3 && s3.dimCount === 2 && s3.matchCount === 0,
  s3_empty_amberBg:            !!s3 && s3.empty === 'true' && s3.styleHasAmber && !s3.styleHasGray,
  s3_text_hasWarnGlyph:        !!s3 && (s3.text || '').includes('⚠'),
  s3_tooltip_widenHint:        !!s3 && (s3.title || '').includes('release one to widen'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pin-intersection empty:`, JSON.stringify(results),
  `\n  s1=`, s1, `\n  s2=`, s2, `\n  s3=`, s3);
process.exit(ok ? 0 : 1);
