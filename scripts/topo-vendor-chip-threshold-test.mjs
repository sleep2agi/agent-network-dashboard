/* Round 281 verification: vendor letters chip threshold tightened
 * from `vendorDist.length > 1` to `vendorDist.length > 2`.
 *
 * Pre-R281: chip rendered whenever ≥2 vendor types existed in the
 * fleet. For a typical Twitter demo (claude + gpt = 2 types), the
 * chip rendered "A:N O:M" adding ~50-80px to the chip-row width.
 *
 * Post-R281: chip only renders when ≥3 vendor types. The typical
 * 1-2 vendor case (most demos) hides the chip; only fleets with
 * actual diverse multi-vendor composition (3+ vendor types) show it.
 *
 * Scenario A: 2 vendor types (claude + gpt) — chip should be ABSENT
 * Scenario B: 3 vendor types (claude + gpt + InternLM) — chip PRESENT
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probeForScenario(sessions) {
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
    const mk = (alias, model) => ({
      alias, status: 'working', model, runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: sessions.map(s => mk(s.alias, s.model)) } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, sessions.length, { timeout: 30000 });
  await page.waitForTimeout(400);
  const result = await page.evaluate(() => {
    const chips = document.querySelectorAll('[data-vendor-letter]');
    return { chipCount: chips.length };
  });
  await ctx.close();
  return result;
}

const twoVendors = await probeForScenario([
  { alias: 'alpha', model: 'claude-opus-4' },
  { alias: 'beta',  model: 'claude-sonnet-4' },
  { alias: 'gamma', model: 'gpt-4o' },
  { alias: 'delta', model: 'gpt-4' },
]);

const threeVendors = await probeForScenario([
  { alias: 'alpha', model: 'claude-opus-4' },
  { alias: 'beta',  model: 'gpt-4o' },
  { alias: 'gamma', model: 'internlm/internlm2' },
  { alias: 'delta', model: 'some-unknown' },
]);

await browser.close();

const results = {
  two_vendor_chip_absent:     twoVendors.chipCount === 0,
  three_vendor_chip_present:  threeVendors.chipCount >= 3,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor chip threshold:`, JSON.stringify(results),
  '\n  2-vendor scenario chip count (expect 0):', twoVendors.chipCount,
  '\n  3-vendor scenario chip count (expect >=3):', threeVendors.chipCount);
process.exit(ok ? 0 : 1);
