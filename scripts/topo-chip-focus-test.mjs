/* Round 155 verification: chip-row interactives gain
 * `.anet-topo-chip-focus` for keyboard focus-visible outline,
 * matching R154's chrome-button treatment.
 *
 * Why `outline` not `box-shadow`: the R88 vendor letter / R139
 * working chip / R140 online chip already use inline boxShadow
 * for the pin-mirror inset. Adding focus-visible:ring (which
 * Tailwind paints via box-shadow) would conflict — inline style
 * wins specificity. `outline: 2px solid currentColor` is on a
 * separate CSS property, no conflict; `currentColor` inherits
 * the chip's own accent (green / cyan / per-vendor / etc.).
 *
 * Test: every chip-row interactive surface carries the class.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
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
    mk('beta',  'idle',    'gpt-4o'),
  ] } });
});

const now = Date.now();
// 1 message to populate flowLinks → active-links chip is interactive
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { id: 'm0', from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - 10000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForTimeout(400);

// Pin status + vendor to surface filter pills + intersection chip
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'working' } }));
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'vendor', value: 'A' } }));
});
await page.waitForTimeout(300);

const inspect = () => page.evaluate(() => {
  const has = (sel) => {
    const el = document.querySelector(sel);
    return el && (el.className || '').includes('anet-topo-chip-focus');
  };
  return {
    pressureSeg_working:  has('[data-pressure-seg="working"]'),
    workingChip:          has('[data-working-chip]'),
    onlineChip:           has('[data-online-chip]'),
    vendorLetter_A:       has('[data-vendor-letter="A"]'),
    activeLinks:          has('[data-active-links-chip]'),
    filterPill_status:    has('[data-active-filter="status"]'),
    filterPill_vendor:    has('[data-active-filter="vendor"]'),
    intersectionChip:     has('[data-pin-intersection]'),
  };
});

const result = await inspect();
await browser.close();

const results = {
  pressureSeg_focusClass: result.pressureSeg_working === true,
  workingChip_focusClass: result.workingChip === true,
  onlineChip_focusClass:  result.onlineChip === true,
  vendorLetter_focusClass: result.vendorLetter_A === true,
  activeLinks_focusClass: result.activeLinks === true,
  filterPillStatus_focusClass: result.filterPill_status === true,
  filterPillVendor_focusClass: result.filterPill_vendor === true,
  intersectionChip_focusClass: result.intersectionChip === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip focus class:`, JSON.stringify(results),
  `\n  raw=`, result);
process.exit(ok ? 0 : 1);
