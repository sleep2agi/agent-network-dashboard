/* Round 417 verification: vendor letter chip count suffix gains
 * inner-span hover-brighten. Extends the family (3rd anchor)
 * after R355 filter pill prefix/suffix + R414 chip-row unit.
 *
 * Contract:
 *   - Vendor chip className includes `group`
 *   - Vendor count suffix span className includes:
 *     * opacity-70 (rest)
 *     * group-hover:opacity-100
 *     * transition-opacity duration-200
 *     * text-gray-400 (label-tier color preserved)
 *     * tabular-nums (R333 invariant)
 *   - Pre-R417 invariants preserved:
 *     * R401 hover:-translate-y-px on chip parent
 *     * data-vendor-letter-count-suffix attr present
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
  const mk = (alias, model) => ({
    alias, status: 'idle', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // R281 vendor chip threshold > 2 distinct vendors — need at least 3
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-5'),
    mk('gamma', 'gemini-2.0-pro'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-vendor-letter-count-suffix]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const suffix = document.querySelector('[data-vendor-letter-count-suffix]');
  if (!suffix) return null;
  const chip = suffix.closest('[data-vendor-letter]');
  return {
    chipClass:    chip?.className ?? null,
    suffixClass:  suffix.className,
    suffixText:   suffix.textContent,
  };
});

await browser.close();

const cc = probe?.chipClass || '';
const sc = probe?.suffixClass || '';
const results = {
  // R417 chip parent gains `group`
  chip_has_group:               cc.includes('group') === true,
  // R417 suffix gets opacity-70 + group-hover:opacity-100 + transition-opacity
  suffix_opacity_70:            sc.includes('opacity-70') === true,
  suffix_group_hover_brighten:  sc.includes('group-hover:opacity-100') === true,
  suffix_transition_opacity:    sc.includes('transition-opacity') === true,
  // Pre-R417 invariants
  suffix_text_gray_400:         sc.includes('text-gray-400') === true,
  suffix_tabular_nums:          sc.includes('tabular-nums') === true,
  suffix_text_format:           /^:\d+$/.test(probe?.suffixText || ''),
  chip_hover_translate:         cc.includes('hover:-translate-y-px') === true,
  chip_tabular_nums:            cc.includes('tabular-nums') === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor letter chip suffix group-hover-brighten:`, JSON.stringify(results),
  '\n  chipClass:  ', cc,
  '\n  suffixClass:', sc,
  '\n  suffixText: ', probe?.suffixText);
process.exit(ok ? 0 : 1);
