/* Round 224 verification: edge midpoint count badge <text> gains
 * tabular-nums (digit-width stable) and a letter-spacing pin
 * signature — 4th surface in the pin-signature typography family
 * after R218 group label / R219 legend row / R220 recent row.
 *
 * The badge stroke already eased on isPinned/isHot flips (R188).
 * Pre-R224 the digit itself was dead-typographic — no transition,
 * no width-stable digits (9 → 10 boundary jitters the centered
 * glyph), no typographic signal on hot/pin crossings.
 *
 * Test scenarios:
 *   A. cold edge (count=4):  pin='false', letter-spacing ≈ 0 ('normal' or '0px')
 *   B. hot edge  (count=12): pin='true',  letter-spacing ≈ 0.4px
 *   Both: fontVariantNumeric includes 'tabular-nums';
 *         transition includes 'letter-spacing 300ms';
 *         data-edge-badge-text + data-edge-badge-text-pin attrs.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function setup(messages) {
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
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-edge-badge-text]', { timeout: 10000, state: 'attached' });
  await page.waitForTimeout(500);
  return page;
}

const probe = async (page) => page.evaluate(() => {
  const txt = document.querySelector('[data-edge-badge-text]');
  if (!txt) return null;
  const cs = getComputedStyle(txt);
  // letter-spacing computed value: '0px' is normalised to 'normal' in
  // some renderers; numeric 0.4px resolves to '0.4px'. Accept both
  // forms for the cold case.
  const ls = cs.letterSpacing;
  const lsNum = ls === 'normal' ? 0 : parseFloat(ls);
  return {
    pin:           txt.getAttribute('data-edge-badge-text-pin'),
    inlineLS:      txt.style.letterSpacing,
    computedLS:    ls,
    lsNum:         lsNum,
    fvn:           cs.fontVariantNumeric,
    inlineTrans:   txt.style.transition,
    text:          txt.textContent,
  };
});

const now = Date.now();
// Scenario A: cold edge — 4 messages alpha→beta (count=4, not hot, not pinned)
const coldMsgs = [];
for (let i = 0; i < 4; i++) {
  coldMsgs.push({
    id: `cold${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
const pageA = await setup(coldMsgs);
const probeA = await probe(pageA);
await pageA.close();

// Scenario B: hot edge — 12 messages alpha→beta (count=12, isHot=true)
const hotMsgs = [];
for (let i = 0; i < 12; i++) {
  hotMsgs.push({
    id: `hot${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
const pageB = await setup(hotMsgs);
const probeB = await probe(pageB);
await pageB.close();
await browser.close();

const results = {
  // A: cold — pin='false', letter-spacing baseline (0 / 'normal' / '0px')
  A_text_present:        probeA !== null,
  A_pin_false:           probeA?.pin === 'false',
  A_ls_baseline:         probeA?.lsNum === 0,
  A_text_is_count_4:     probeA?.text === '4',
  A_tabular_nums:        /tabular-nums/.test(probeA?.fvn || ''),
  A_transition_has_ls:   /letter-spacing\s+(?:300ms|0\.3s)/.test(probeA?.inlineTrans || ''),

  // B: hot — pin='true', letter-spacing widened to 0.4px
  B_text_present:        probeB !== null,
  B_pin_true:            probeB?.pin === 'true',
  B_ls_widened:          Math.abs((probeB?.lsNum ?? 0) - 0.4) < 0.05,
  B_text_is_count_12:    probeB?.text === '12',
  B_tabular_nums:        /tabular-nums/.test(probeB?.fvn || ''),
  B_transition_has_ls:   /letter-spacing\s+(?:300ms|0\.3s)/.test(probeB?.inlineTrans || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-badge-text pin-signature:`, JSON.stringify(results),
  `\n  probeA (cold count=4):`,  probeA,
  `\n  probeB (hot  count=12):`, probeB);
process.exit(ok ? 0 : 1);
