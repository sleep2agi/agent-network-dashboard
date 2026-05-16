/* Round 362 verification: 3 chip-row chip digits (working / online /
 * active-links) wrap their digit in a font-semibold span, lifting it
 * fw 500 (chip-row R313 baseline) → fw 600 within each chip. The
 * outer chip className keeps font-medium so the chip's overall data-
 * weight stays consistent with the R313 family; the digit override
 * adds a within-chip tier:
 *   digit  fw 600 + full opacity
 *   unit   fw 500 + R338 opacity-70
 *
 * Joins the R333-R341 chip-internal-hierarchy arc at the chip-count
 * scope (8th surface family).
 *
 * Contract (cyber, fresh fixture):
 *   - Each of the 3 chip digit spans has data-{name}-chip-digit attr.
 *   - Computed fontWeight of the digit span === '600'.
 *   - The unit sibling span still has opacity 0.7 + data-{name}-chip-
 *     unit attr (R338 invariants).
 *   - Parent chip retains font-medium (R313 baseline).
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
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-working-chip-digit]',      { timeout: 15000 });
await page.waitForSelector('[data-online-chip-digit]',       { timeout: 5000 });
await page.waitForSelector('[data-active-links-chip-digit]', { timeout: 5000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  function readChip(digitSel, unitSel, parentSel) {
    const digit  = document.querySelector(digitSel);
    const unit   = document.querySelector(unitSel);
    const parent = document.querySelector(parentSel);
    return {
      digitFw:    digit ? getComputedStyle(digit).fontWeight : null,
      digitText:  digit?.textContent ?? null,
      unitOp:     unit ? getComputedStyle(unit).opacity : null,
      unitPresent: !!unit,
      parentCls:  parent?.getAttribute('class') ?? null,
    };
  }
  return {
    working:     readChip('[data-working-chip-digit]',      '[data-working-chip-unit]',      '[data-working-chip]'),
    online:      readChip('[data-online-chip-digit]',       '[data-online-chip-unit]',       '[data-online-chip]'),
    activeLinks: readChip('[data-active-links-chip-digit]', '[data-active-links-chip-unit]', '[data-active-links-chip]'),
  };
});

await browser.close();

const isFw600 = (v) => v === '600' || v === 'bold';   // Tailwind font-semibold === 600
const approxEq = (a, b, tol = 0.02) => {
  const x = parseFloat(a); const y = parseFloat(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;
};

const checkChip = (chip) => ({
  digit_fw_600:    isFw600(chip.digitFw),
  unit_op_0_7:     approxEq(chip.unitOp, 0.7),     // R338
  unit_present:    chip.unitPresent,
  parent_medium:   /font-medium/.test(chip.parentCls || ''),  // R313
});

const results = {
  working_digit_fw_600:    checkChip(probe.working).digit_fw_600,
  working_unit_op_0_7:     checkChip(probe.working).unit_op_0_7,
  working_parent_medium:   checkChip(probe.working).parent_medium,
  online_digit_fw_600:     checkChip(probe.online).digit_fw_600,
  online_unit_op_0_7:      checkChip(probe.online).unit_op_0_7,
  online_parent_medium:    checkChip(probe.online).parent_medium,
  active_digit_fw_600:     checkChip(probe.activeLinks).digit_fw_600,
  active_unit_op_0_7:      checkChip(probe.activeLinks).unit_op_0_7,
  active_parent_medium:    checkChip(probe.activeLinks).parent_medium,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip-row digit fontWeight 500 → 600:`, JSON.stringify(results),
  '\n  probe:', JSON.stringify(probe, null, 2));
process.exit(ok ? 0 : 1);
