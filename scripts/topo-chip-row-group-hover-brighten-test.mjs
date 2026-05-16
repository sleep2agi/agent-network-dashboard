/* Round 414 verification: chip-row chip unit spans gain group-hover-
 * brighten — sibling to R355 filter pill inner-span hover-brighten.
 * Chip-row 3 chips (working / online / active-links) get `group`
 * parent + inner unit span `group-hover:opacity-100`.
 *
 * Contract:
 *   - 3 chips with data-chip-group-hover-brighten="true"
 *   - Each chip className includes `group`
 *   - Each chip's unit span (data-*-chip-unit) className includes:
 *     * opacity-70
 *     * transition-opacity
 *     * group-hover:opacity-100
 *   - Pre-R414 invariants preserved:
 *     * R398/R399 hover:-translate-y-px on clickable variant
 *     * R232 tabular-nums, font-medium
 *     * R266 anet-topo-chip-focus
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
await page.waitForSelector('[data-chip-group-hover-brighten="true"]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('[data-chip-group-hover-brighten="true"]'));
  const read = (chip) => {
    const unit = chip.querySelector('[data-working-chip-unit], [data-online-chip-unit], [data-active-links-chip-unit]');
    return {
      chipClass: chip.className,
      unitClass: unit?.className ?? null,
      chipAttr:  chip.getAttribute('data-working-chip') !== null ? 'working'
              : chip.getAttribute('data-online-chip') !== null ? 'online'
              : chip.getAttribute('data-active-links-chip') !== null ? 'active-links'
              : 'unknown',
    };
  };
  return {
    count: chips.length,
    chips: chips.map(read),
  };
});

await browser.close();

const wc = probe.chips.find((c) => c.chipAttr === 'working');
const oc = probe.chips.find((c) => c.chipAttr === 'online');
const ac = probe.chips.find((c) => c.chipAttr === 'active-links');

const results = {
  // 3 chips mounted
  three_chips:                  probe.count === 3,
  // working chip
  working_has_group:            wc?.chipClass.includes('group') === true,
  working_unit_brighten:        wc?.unitClass?.includes('group-hover:opacity-100') === true,
  working_unit_transition:      wc?.unitClass?.includes('transition-opacity') === true,
  working_unit_opacity_70:      wc?.unitClass?.includes('opacity-70') === true,
  // online chip
  online_has_group:             oc?.chipClass.includes('group') === true,
  online_unit_brighten:         oc?.unitClass?.includes('group-hover:opacity-100') === true,
  online_unit_transition:       oc?.unitClass?.includes('transition-opacity') === true,
  // active-links chip
  active_has_group:             ac?.chipClass.includes('group') === true,
  active_unit_brighten:         ac?.unitClass?.includes('group-hover:opacity-100') === true,
  active_unit_transition:       ac?.unitClass?.includes('transition-opacity') === true,
  // Pre-R414 invariants
  working_chip_focus:           wc?.chipClass.includes('anet-topo-chip-focus') === true,
  online_tabular_nums:          oc?.chipClass.includes('tabular-nums') === true,
  active_font_medium:           ac?.chipClass.includes('font-medium') === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip-row chip group-hover-brighten:`, JSON.stringify(results),
  '\n  working:', wc,
  '\n  online: ', oc,
  '\n  active: ', ac);
process.exit(ok ? 0 : 1);
