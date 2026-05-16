/* Round 398 verification: chip-row chips (working / online) gain
 * hover translateY(-1px) lift on clickable variant only. Extends
 * R397's filter-pill lift to the static header chips, gated to
 * the chip's clickable role so empty chips stay planted.
 *
 * Contract:
 *   - Populated working chip (workingCount > 0):
 *     * data-chip-hover-lift === 'true'
 *     * className includes 'hover:-translate-y-px'
 *     * className includes 'transition-transform' + 'transform-gpu'
 *   - Populated online chip (onlineNodes.length > 0):
 *     * data-chip-hover-lift === 'true'
 *     * className includes 'hover:-translate-y-px'
 *   - Pre-R398 invariants preserved:
 *     * transition-colors duration-200 still present
 *     * R201 hover:bg + hover:border tokens still present
 *     * anet-topo-chip-focus + tabular-nums + font-medium present
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-working-chip]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const work = document.querySelector('[data-working-chip]');
  const online = document.querySelector('[data-online-chip]');
  return {
    work: work ? {
      className: work.className,
      lift:      work.getAttribute('data-chip-hover-lift'),
      clickable: work.getAttribute('data-working-chip-clickable'),
    } : null,
    online: online ? {
      className: online.className,
      lift:      online.getAttribute('data-chip-hover-lift'),
      clickable: online.getAttribute('data-online-chip-clickable'),
    } : null,
  };
});

await browser.close();

const wc = probe.work?.className || '';
const oc = probe.online?.className || '';
const results = {
  // working chip: clickable + R398 lift attrs + className tokens
  work_lift_true:               probe.work?.lift === 'true',
  work_clickable_true:          probe.work?.clickable === 'true',
  work_has_hover_translate:     wc.includes('hover:-translate-y-px'),
  work_has_transition_transform: wc.includes('transition-transform'),
  work_has_transform_gpu:       wc.includes('transform-gpu'),
  work_has_transition_colors:   wc.includes('transition-colors'),  // R201 preserved
  work_has_hover_bg:            wc.includes('hover:bg-green-500/15'),  // R201 preserved
  work_has_chip_focus:          wc.includes('anet-topo-chip-focus'),
  // online chip mirror
  online_lift_true:             probe.online?.lift === 'true',
  online_clickable_true:        probe.online?.clickable === 'true',
  online_has_hover_translate:   oc.includes('hover:-translate-y-px'),
  online_has_transition_transform: oc.includes('transition-transform'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip-row chips hover lift translateY(-1px):`, JSON.stringify(results),
  '\n  workingClass:', wc,
  '\n  onlineClass: ', oc);
process.exit(ok ? 0 : 1);
