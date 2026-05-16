/* Round 236 verification: pin-intersection chip gets a smooth
 * colour-easing transition on the empty↔non-empty crossing.
 *
 * Pre-R236 the chip's bg/color/borderColor snap-flipped between
 * slate (non-empty intersection) and amber (empty — the 'pinned
 * filters cancel out' warning). R236 adds a 200ms ease-out
 * transition so the colour shift eases through the boundary.
 *
 * Scenario: 4 sessions × 2 vendors × 2 statuses; pin two filter
 * dims that yield an intersection > 0 first (non-empty: slate),
 * then verify the chip's inline transition includes all three
 * color-related properties.
 *
 * Probing the transition wiring is enough — the visual ease itself
 * is a CSS browser detail. We just need the transition string to
 * include background-color + color + border-color with 200ms.
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
  // Scenario tuned so we can flip intersection 1 → 0 by swapping
  // the pinned vendor: alpha is the ONLY working anthropic; gpt
  // sessions are both idle. Pin working+A → alpha (non-empty).
  // Then re-pin vendor to 'O' (vendor is single-value, so 'A' is
  // released and 'O' takes its place) → working+O = 0 (empty).
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

// Pin working + anthropic (intersection = alpha, non-empty)
await page.locator('[data-pressure-seg="working"]').first().click();
await page.locator('[data-vendor-letter="A"]').first().click();
await page.waitForSelector('[data-pin-intersection]', { timeout: 5000, state: 'attached' });
await page.waitForTimeout(300);

const nonEmpty = await page.evaluate(() => {
  const chip = document.querySelector('[data-pin-intersection]');
  if (!chip) return null;
  return {
    empty:      chip.getAttribute('data-pin-intersection-empty'),
    transition: chip.style.transition,
    bg:         chip.style.background,
    color:      chip.style.color,
  };
});

// Re-pin vendor 'O' — pinnedVendor is single-value, so 'A' releases
// and 'O' takes its place. working ∩ openai = 0 (gpt sessions are
// all idle) → chip flips to empty=true.
await page.locator('[data-vendor-letter="O"]').first().click();
await page.waitForTimeout(300);

const empty = await page.evaluate(() => {
  const chip = document.querySelector('[data-pin-intersection]');
  if (!chip) return null;
  return {
    empty:      chip.getAttribute('data-pin-intersection-empty'),
    transition: chip.style.transition,
    bg:         chip.style.background,
    color:      chip.style.color,
  };
});
await browser.close();

const hasTransition = (s, prop) => new RegExp(`${prop.replace('-', '-')}\\s+200ms`).test(s || '');

const results = {
  nonempty_mounted:           nonEmpty !== null,
  nonempty_empty_attr:        nonEmpty?.empty === 'false',
  nonempty_has_bg_transition:  hasTransition(nonEmpty?.transition, 'background-color'),
  nonempty_has_color_transition: hasTransition(nonEmpty?.transition, 'color'),
  nonempty_has_border_transition: hasTransition(nonEmpty?.transition, 'border-color'),
  empty_mounted:              empty !== null,
  empty_empty_attr:           empty?.empty === 'true',
  empty_has_bg_transition:    hasTransition(empty?.transition, 'background-color'),
  empty_has_color_transition: hasTransition(empty?.transition, 'color'),
  empty_has_border_transition: hasTransition(empty?.transition, 'border-color'),
  color_changed_on_flip:      nonEmpty?.color !== empty?.color,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pin-intersection color ease:`, JSON.stringify(results),
  '\n  nonEmpty:', nonEmpty,
  '\n  empty:   ', empty);
process.exit(ok ? 0 : 1);
