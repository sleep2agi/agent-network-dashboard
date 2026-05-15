/* Round 101 verification: vendor-letter chip <span>s carry an alias-
 * list tooltip. Completes the R97/R98/R99 info-density sweep — every
 * surface that shows "X:N" should hover-explain which N.
 *
 * Fleet: 2 Claude (alpha, gamma), 2 GPT (beta, delta). Vendor chip
 * shows "A:2 O:2". A letter's tooltip should list alpha, gamma;
 * O letter's should list beta, delta. Pin state flips the trailing
 * action hint ("click to pin" → "click again or Esc to clear").
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-vendor');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, model) => ({
    alias, status: 'idle', model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-5'),
    mk('gamma', 'claude-opus-4'),
    mk('delta', 'gpt-5'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const read = (initial) => page.evaluate((i) => {
  const el = document.querySelector(`[data-vendor-letter="${i}"]`);
  if (!el) return null;
  return {
    title:   el.getAttribute('title') || '',
    aliases: el.getAttribute('data-vendor-aliases') || '',
    pinned:  el.getAttribute('data-vendor-pinned') || '',
  };
}, initial);

const aSnap = await read('A');
const oSnap = await read('O');

// Pin A — title should flip.
await page.locator('[data-vendor-letter="A"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const aPinned = await read('A');

await browser.close();

const sameSet = (csv, expected) => {
  const got = new Set(csv.split(',').filter(Boolean));
  const exp = new Set(expected);
  return got.size === exp.size && [...exp].every(x => got.has(x));
};

const results = {
  a_aliasesMatch:     sameSet(aSnap?.aliases || '', ['alpha', 'gamma']),
  a_titleListsThem:   /alpha.*gamma|gamma.*alpha/.test(aSnap?.title || ''),
  a_titleClickToPin:  /click to pin/.test(aSnap?.title || ''),
  o_aliasesMatch:     sameSet(oSnap?.aliases || '', ['beta', 'delta']),
  o_titleListsThem:   /beta.*delta|delta.*beta/.test(oSnap?.title || ''),
  pinnedA_aliasesUnchanged: sameSet(aPinned?.aliases || '', ['alpha', 'gamma']),
  pinnedA_titleHintFlipped: /click again or Esc to clear/.test(aPinned?.title || ''),
  pinnedA_pinnedAttrTrue:   aPinned?.pinned === 'true',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor-letter tooltip:`, JSON.stringify(results),
  `\n  A:`,       aSnap,
  `\n  O:`,       oSnap,
  `\n  A-pinned:`, aPinned);
process.exit(ok ? 0 : 1);
