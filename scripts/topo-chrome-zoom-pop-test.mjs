/* Round 186 verification: chrome zoom-in / zoom-out buttons get
 * a one-shot icon "pop" on click — same click-feel idiom R184
 * added for the reset spin, applied to the two zoom buttons.
 *
 * Test:
 *   1. Idle: neither popping
 *   2. Click chrome zoom-in → zoom-in icon gets 'anet-chrome-pop',
 *      attr 'true' within 50ms
 *   3. Wait 280ms → class + attr cleared
 *   4. Click chrome zoom-out → zoom-out icon gets the class, attr
 *      'true'; zoom-in stays cleared
 *   5. CSS keyframe 'anet-chrome-pop' exists in stylesheet and
 *      includes scale(1.18)
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const inBtn = document.querySelector('[data-topo-chrome-zoom-in]');
  const outBtn = document.querySelector('[data-topo-chrome-zoom-out]');
  const inIcon = document.querySelector('[data-topo-chrome-zoom-in-icon]');
  const outIcon = document.querySelector('[data-topo-chrome-zoom-out-icon]');
  return {
    inAttr:   inBtn?.getAttribute('data-topo-chrome-zoom-in-popping'),
    outAttr:  outBtn?.getAttribute('data-topo-chrome-zoom-out-popping'),
    inClass:  inIcon?.getAttribute('class') || '',
    outClass: outIcon?.getAttribute('class') || '',
  };
});

const idle = await probe();

await page.locator('[data-topo-chrome-zoom-in]').click();
await page.waitForTimeout(50);
const duringIn = await probe();

await page.waitForTimeout(280);
const afterIn = await probe();

await page.locator('[data-topo-chrome-zoom-out]').click();
await page.waitForTimeout(50);
const duringOut = await probe();

await page.waitForTimeout(280);
const afterOut = await probe();

const cssCheck = await page.evaluate(() => {
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.type === 7 && rule.name === 'anet-chrome-pop') {
        return { found: true, cssText: rule.cssText };
      }
    }
  }
  return { found: false, cssText: '' };
});

await browser.close();

const results = {
  idle_in_attr_false:        idle.inAttr === 'false',
  idle_out_attr_false:       idle.outAttr === 'false',
  idle_no_in_pop:            !idle.inClass.includes('anet-chrome-pop'),
  idle_no_out_pop:           !idle.outClass.includes('anet-chrome-pop'),

  // After zoom-in click: in popping, out static
  in_attr_true:              duringIn.inAttr === 'true',
  in_has_pop_class:          duringIn.inClass.includes('anet-chrome-pop'),
  out_stays_false:           duringIn.outAttr === 'false',
  out_no_pop_class:          !duringIn.outClass.includes('anet-chrome-pop'),

  // After 280ms: in cleared
  after_in_attr_false:       afterIn.inAttr === 'false',
  after_in_no_pop:           !afterIn.inClass.includes('anet-chrome-pop'),

  // After zoom-out click: out popping
  out_attr_true:             duringOut.outAttr === 'true',
  out_has_pop_class:         duringOut.outClass.includes('anet-chrome-pop'),
  in_stays_false:            duringOut.inAttr === 'false',
  in_no_pop_after:           !duringOut.inClass.includes('anet-chrome-pop'),

  // After 280ms: out cleared
  after_out_attr_false:      afterOut.outAttr === 'false',
  after_out_no_pop:          !afterOut.outClass.includes('anet-chrome-pop'),

  keyframe_found:            cssCheck.found,
  keyframe_has_scale_1p18:   cssCheck.cssText.includes('scale(1.18)'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome zoom pop:`, JSON.stringify(results),
  `\n  idle:`, idle,
  `\n  duringIn:`, duringIn,
  `\n  afterIn:`, afterIn,
  `\n  duringOut:`, duringOut,
  `\n  afterOut:`, afterOut,
  `\n  keyframe found:`, cssCheck.found);
process.exit(ok ? 0 : 1);
