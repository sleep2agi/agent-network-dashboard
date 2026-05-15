/* Round 67 verification: filter pills shed the "filter:" prefix on
 * narrow viewports and gain an anet-fade-in entrance.
 *  - At <sm (375 px) the prefix span has `display:none` via the
 *    `hidden sm:inline` class — visible pill text = "working×".
 *  - At sm+ (900 px) the prefix is visible — "filter: working ×".
 *  - The pill `<span>` carries `anet-fade-in` class so it eases in
 *    on mount (entrance polish).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      sessionStorage.setItem('anet_v3_auth', '1');
      // Pre-seed the working pin via R66 persistence so the pill exists
      // on first paint — keeps the test independent of click wiring.
      sessionStorage.setItem('anet-topo-pinned-status', 'working');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = [
      { alias: 'wkr',  status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
      { alias: 'idl',  status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    ];
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  // Mobile viewport auto-hides the topology section; click "Show Topology"
  // if the button surfaces. Otherwise the pill still renders in the chip
  // row (chip row is independent of canvas visibility).
  await page.waitForTimeout(1200);
  const showBtn = page.locator('button', { hasText: /Show Topology/i });
  if (await showBtn.count() > 0) await showBtn.first().click();
  await page.waitForSelector('[data-active-filter="status"]', { timeout: 15000 });

  const info = await page.evaluate(() => {
    const pill = document.querySelector('[data-active-filter="status"]');
    if (!pill) return null;
    const prefix = pill.querySelector('[data-filter-prefix]');
    // innerText respects display:none (vs textContent which includes
    // all DOM text); that's the visible-to-the-user version.
    return {
      pillText:   (pill.innerText || '').trim(),
      pillFull:   (pill.textContent || '').trim(),
      pillClasses: pill.getAttribute('class') || '',
      hasFadeIn: /\banet-fade-in\b/.test(pill.getAttribute('class') || ''),
      prefixVisible: prefix
        ? (() => {
            const r = prefix.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })()
        : false,
      prefixDisplay: prefix ? getComputedStyle(prefix).display : null,
    };
  });
  await ctx.close();
  return info;
}

const mobile  = await probe(375);
const desktop = await probe(900);
await browser.close();

const results = {
  mobile_prefixHidden:    mobile && mobile.prefixVisible === false && mobile.prefixDisplay === 'none',
  mobile_textNoPrefix:    mobile && /^working/.test(mobile.pillText.trim()),
  mobile_hasFadeIn:       mobile && mobile.hasFadeIn === true,
  desktop_prefixVisible:  desktop && desktop.prefixVisible === true,
  desktop_textWithPrefix: desktop && /^filter:\s*working/.test(desktop.pillText.trim()),
  desktop_hasFadeIn:      desktop && desktop.hasFadeIn === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pill mobile:`, JSON.stringify(results),
  `\n  mobile=`, mobile,
  `\n  desktop=`, desktop);
process.exit(ok ? 0 : 1);
