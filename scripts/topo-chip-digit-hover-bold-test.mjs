/* Round 416 verification (100-round milestone): chip-row chip digits
 * gain group-hover:font-bold. Extends chip-internal-hierarchy with a
 * hover-state weight lift — digits lift from fw=600 (R362 font-semibold)
 * to fw=700 (font-bold) on chip hover, matching the R414 unit-brighten
 * gesture at the same scope.
 *
 * Contract:
 *   - 3 chip digits with class tokens:
 *     * font-semibold (rest)
 *     * group-hover:font-bold
 *     * transition-[font-weight] duration-200
 *   - Parent chip className has `group` (R414 invariant)
 *   - Pre-R416 invariants:
 *     * data-*-chip-digit attrs present
 *     * unit spans group-hover:opacity-100 (R414 invariant)
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-working-chip-digit]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const read = (selector) => {
    const el = document.querySelector(selector);
    return el ? {
      className: el.className,
      parentHasGroup: el.parentElement?.className.includes('group') === true,
    } : null;
  };
  return {
    working:     read('[data-working-chip-digit]'),
    online:      read('[data-online-chip-digit]'),
    activeLinks: read('[data-active-links-chip-digit]'),
  };
});

await browser.close();

const check = (digit) => digit &&
  digit.className.includes('font-semibold') &&
  digit.className.includes('group-hover:font-bold') &&
  digit.className.includes('transition-[font-weight]') &&
  digit.className.includes('duration-200') &&
  digit.parentHasGroup;

const results = {
  // All 3 chip digits mounted
  working_digit_mounted:     !!probe.working,
  online_digit_mounted:      !!probe.online,
  active_digit_mounted:      !!probe.activeLinks,
  // Each has all R416 + R414 invariants
  working_full_set:          check(probe.working),
  online_full_set:           check(probe.online),
  active_full_set:           check(probe.activeLinks),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip-row chip digit group-hover:font-bold (R416 milestone):`, JSON.stringify(results),
  '\n  working:', probe.working?.className,
  '\n  online: ', probe.online?.className,
  '\n  active: ', probe.activeLinks?.className);
process.exit(ok ? 0 : 1);
