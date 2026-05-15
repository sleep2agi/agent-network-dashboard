/* Round 130 verification: hub center shows workingCount digit when
 * > 0. The R84 busyness breath already encodes workingCount through
 * motion (peak amplitude + period both vary with count buckets);
 * R130 adds a second channel — the digit itself — at the canvas's
 * focal point. A glance at the hub now answers two questions
 * simultaneously: "is the fleet busy" (motion) and "how busy" (number).
 *
 * Layout invariant: workingCount=0 falls through to the existing
 * decorative highlight (data-topo-hub-highlight); workingCount>0
 * swaps it for the digit text (data-topo-hub-working-count={N}).
 *
 * Three states:
 *   A. all idle (0 working)        → decorative highlight rendered,
 *                                    no digit text
 *   B. mix (3 working)             → digit "3" rendered, no highlight
 *   C. all working (5 working)     → digit "5" rendered, no highlight
 *
 * Additional assertion: hub click-to-fit (R52) still works when
 * the digit is rendered — the text's pointerEvents:none means the
 * digit can't intercept clicks meant for the hub <g>.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

async function probe(workingCount, totalCount = 5) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = [];
    for (let i = 0; i < totalCount; i++) {
      sessions.push({
        alias: `node${i}`,
        status: i < workingCount ? 'working' : 'idle',
        model: 'claude-opus-4', runtime: 'cli-claude-code',
        network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: fresh,
      });
    }
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, totalCount, { timeout: 30000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const digit = document.querySelector('[data-topo-hub-working-count]');
    const highlight = document.querySelector('[data-topo-hub-highlight]');
    return {
      digitPresent:    !!digit,
      digitText:       digit?.textContent,
      digitAttr:       digit?.getAttribute('data-topo-hub-working-count'),
      digitPointerEv:  digit?.getAttribute('style')?.includes('pointer-events: none'),
      highlightPresent: !!highlight,
    };
  });

  await browser.close();
  return out;
}

const a = await probe(0, 3);
const b = await probe(3, 5);
const c = await probe(5, 5);

const results = {
  a_noDigit:           !a.digitPresent,
  a_hasHighlight:      a.highlightPresent,

  b_hasDigit:          b.digitPresent,
  b_digitText3:        b.digitText === '3',
  b_digitAttr3:        b.digitAttr === '3',
  b_pointerNone:       b.digitPointerEv === true,
  b_noHighlight:       !b.highlightPresent,

  c_hasDigit:          c.digitPresent,
  c_digitText5:        c.digitText === '5',
  c_digitAttr5:        c.digitAttr === '5',
  c_noHighlight:       !c.highlightPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub working count:`, JSON.stringify(results),
  `\n  A(0 working)=`, a,
  `\n  B(3 working)=`, b,
  `\n  C(5 working)=`, c);
process.exit(ok ? 0 : 1);
