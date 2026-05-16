/* Round 399 verification: active-links chip closes the 3-chip
 * chip-row by extending R398 hover translate-y-px lift onto the
 * third (rightmost) chip. Gated to clickable variant (flowLinks
 * > 0) so empty active-links chip stays planted.
 *
 * Contract:
 *   - With seeded messages (active flow links present):
 *     * data-chip-hover-lift === 'true'
 *     * data-active-links-clickable === 'true'
 *     * className includes 'hover:-translate-y-px'
 *     * className includes 'transition-transform' + 'transform-gpu'
 *   - Pre-R399 invariants preserved:
 *     * R232 tabular-nums + R313 font-medium + R266 chip-focus
 *     * R193 hover:bg-cyan-500/10 + hover:text-cyan-200 + hover:border-cyan-500/30
 *     * inline transition list still covers color/bg/border/opacity
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
    mk('gamma', 'idle'),
  ] } });
});
// Seed messages so flowLinks > 0 → chip becomes clickable
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
    { id: 'm2', from_alias: 'alpha', to_alias: 'gamma', content: 'pong', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-active-links-chip]', { timeout: 15000 });
await page.waitForTimeout(600);

const probe = await page.evaluate(() => {
  const chip = document.querySelector('[data-active-links-chip]');
  return chip ? {
    className: chip.className,
    lift:      chip.getAttribute('data-chip-hover-lift'),
    clickable: chip.getAttribute('data-active-links-clickable'),
    flowCount: chip.getAttribute('data-active-links-flow-count'),
  } : null;
});

await browser.close();

const cls = probe?.className || '';
const results = {
  // Setup: active-links chip mounted with flow > 0
  chip_mounted:                 !!probe,
  flow_count_present:           parseInt(probe?.flowCount || '0', 10) > 0,
  // R399 lift attrs + className tokens (clickable variant)
  lift_true:                    probe?.lift === 'true',
  clickable_true:               probe?.clickable === 'true',
  has_hover_translate:          cls.includes('hover:-translate-y-px'),
  has_transition_transform:     cls.includes('transition-transform'),
  has_transform_gpu:            cls.includes('transform-gpu'),
  // Pre-R399 invariants
  has_tabular_nums:             cls.includes('tabular-nums'),
  has_font_medium:              cls.includes('font-medium'),
  has_chip_focus:               cls.includes('anet-topo-chip-focus'),
  has_hover_cyan_bg:            cls.includes('hover:bg-cyan-500/10'),  // R193 invariant
  has_hover_cyan_text:          cls.includes('hover:text-cyan-200'),
  has_hover_cyan_border:        cls.includes('hover:border-cyan-500/30'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links chip hover lift translateY(-1px):`, JSON.stringify(results),
  '\n  className:', cls,
  '\n  flowCount:', probe?.flowCount, '/ lift:', probe?.lift, '/ clickable:', probe?.clickable);
process.exit(ok ? 0 : 1);
