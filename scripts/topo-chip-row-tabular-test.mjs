/* Round 232 verification: HTML chip row (working / online / active-
 * links) gains the Tailwind `tabular-nums` utility class so the digit
 * width stays stable across counter rollovers (9→10, 99→100).
 *
 * 7th surface in the info-density tabular-nums sweep — first on the
 * HTML side (previous 6 were SVG <text>/<tspan>):
 *   R224 edge midpoint badge digit
 *   R225 hub center digit
 *   R225 recent panel header tspan
 *   R225 recent row count tspan
 *   R229 group-label · count chip
 *   R230 R58 status pip strip × 3 tiers
 *   R232 chip row × 3 chips (this round)
 *
 * Scenario: 4 working agents + 1 flow alpha→beta count=5. Drives
 * workingCount=4, onlineNodes.length=4, flowLinks.length=1 → all
 * three chips render with non-empty digits.
 *
 * Verifies for each chip:
 *   - element present at its data attr selector
 *   - getComputedStyle().fontVariantNumeric includes 'tabular-nums'
 *   - textContent starts with the expected digit (sanity)
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
const now = Date.now();
const msgs = [];
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-working-chip]',      { timeout: 10000, state: 'attached' });
await page.waitForSelector('[data-online-chip]',       { timeout: 10000, state: 'attached' });
await page.waitForSelector('[data-active-links-chip]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const grab = (sel, expectedPrefix) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      present:        true,
      fontVarNumeric: getComputedStyle(el).fontVariantNumeric,
      hasUtility:     el.className.split(/\s+/).includes('tabular-nums'),
      textStartsWith: (el.textContent || '').trim().startsWith(expectedPrefix),
      text:           (el.textContent || '').trim().slice(0, 30),
    };
  };
  return {
    working:     grab('[data-working-chip]',      '4 working'),
    online:      grab('[data-online-chip]',       '4 online'),
    activeLinks: grab('[data-active-links-chip]', '1 active'),
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');
const present = (o) => o && o.present;

const results = {
  working_present:        present(out.working),
  working_class_utility:  out.working?.hasUtility === true,
  working_fvn_tabular:    hasTab(out.working?.fontVarNumeric),
  working_text_ok:        out.working?.textStartsWith === true,

  online_present:         present(out.online),
  online_class_utility:   out.online?.hasUtility === true,
  online_fvn_tabular:     hasTab(out.online?.fontVarNumeric),
  online_text_ok:         out.online?.textStartsWith === true,

  active_present:         present(out.activeLinks),
  active_class_utility:   out.activeLinks?.hasUtility === true,
  active_fvn_tabular:     hasTab(out.activeLinks?.fontVarNumeric),
  active_text_ok:         out.activeLinks?.textStartsWith === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip row tabular-nums:`, JSON.stringify(results),
  '\n  working:    ', out.working,
  '\n  online:     ', out.online,
  '\n  activeLinks:', out.activeLinks);
process.exit(ok ? 0 : 1);
