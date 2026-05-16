/* Round 237 verification: pin-intersection chip's ⚠ warning glyph
 * always-mounts with opacity gated on isEmpty, instead of
 * conditional render on isEmpty. Closes the snap-mount + layout-
 * shift jank that survived R236's color easing.
 *
 * Test scope:
 *   - non-empty state: glyph in DOM, data-pin-intersection-warning
 *     ='false', opacity=0, transition includes 'opacity 200ms'
 *   - empty state:     glyph in DOM, data-pin-intersection-warning
 *     ='true',  opacity=1, transition still present
 *   - chip width: stable across the crossing (no layout-shift)
 *
 * Reuses the R236 scenario tuning — alpha is the only working
 * anthropic, gpt sessions all idle; pin working+A (non-empty)
 * then re-pin vendor to O (empty).
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
  const mk = (alias, model, status) => ({
    alias, status, model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4', 'working'),
    mk('beta',  'claude-opus-4', 'idle'),
    mk('gamma', 'gpt-4',         'idle'),
    mk('delta', 'gpt-4',         'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });

await page.locator('[data-pressure-seg="working"]').first().click();
await page.locator('[data-vendor-letter="A"]').first().click();
await page.waitForSelector('[data-pin-intersection-warning]', { timeout: 5000, state: 'attached' });
await page.waitForTimeout(300);

const probe = (page) => page.evaluate(() => {
  const glyph = document.querySelector('[data-pin-intersection-warning]');
  const chip = document.querySelector('[data-pin-intersection]');
  if (!glyph || !chip) return null;
  return {
    present:      true,
    warning:      glyph.getAttribute('data-pin-intersection-warning'),
    opacity:      parseFloat(glyph.style.opacity || '1'),
    transition:   glyph.style.transition,
    text:         glyph.textContent,
    chipWidthPx:  Math.round(chip.getBoundingClientRect().width * 100) / 100,
    chipEmpty:    chip.getAttribute('data-pin-intersection-empty'),
  };
});

const nonEmpty = await probe(page);

// Flip vendor pin to 'O' — working ∩ openai = 0 (gpt all idle) → empty
await page.locator('[data-vendor-letter="O"]').first().click();
await page.waitForTimeout(300);
const empty = await probe(page);

await browser.close();

const widthDelta = nonEmpty && empty
  ? Math.abs(nonEmpty.chipWidthPx - empty.chipWidthPx)
  : Infinity;

const results = {
  nonempty_in_dom:           nonEmpty?.present === true,
  nonempty_warning_false:    nonEmpty?.warning === 'false',
  nonempty_opacity_0:        nonEmpty?.opacity === 0,
  nonempty_has_transition:   /opacity\s+200ms/.test(nonEmpty?.transition || ''),
  nonempty_text_is_warning:  nonEmpty?.text === '⚠',
  nonempty_chip_empty_false: nonEmpty?.chipEmpty === 'false',

  empty_in_dom:              empty?.present === true,
  empty_warning_true:        empty?.warning === 'true',
  empty_opacity_1:           empty?.opacity === 1,
  empty_has_transition:      /opacity\s+200ms/.test(empty?.transition || ''),
  empty_chip_empty_true:     empty?.chipEmpty === 'true',

  // Chip width stable across the crossing (no layout-shift jank).
  // 1px tolerance for fractional rounding only.
  chip_width_stable:         widthDelta <= 1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pin-intersection warning crossfade:`, JSON.stringify(results),
  '\n  nonEmpty:', nonEmpty,
  '\n  empty:   ', empty,
  '\n  widthDelta:', widthDelta);
process.exit(ok ? 0 : 1);
