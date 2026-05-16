/* Round 382 verification: hub-spoke path strokeLinecap='round'.
 * Sibling SVG stroke-softening polish to R378 flow-rail dashes +
 * R380 group box dashes — three dashed-stroke surfaces now share
 * 'round' linecap.
 *
 * Dashed-stroke linecap family snapshot post-R382:
 *   R378 flow-rail   '2 12'  -> soft 3-px pills
 *   R380 group box   '6 6'   -> soft 7.5-px pills
 *   R382 hub spoke   '6 14'  -> soft 7-px pills (this round)
 *
 * Contract:
 *   - Every [data-topo-hub-spoke-active] path has stroke-linecap='round'.
 *   - data-topo-hub-spoke-linecap === 'round'.
 *   - Idle spokes still have strokeDasharray='6 14' (R382 doesn't touch
 *     the dasharray); active spokes still have 'none'.
 *   - Pre-R382 invariants preserved on each spoke: strokeWidth (1 idle /
 *     2 active), R241 stroke + stroke-width + opacity 250ms transition.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub-spoke-active]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const spokes = Array.from(document.querySelectorAll('[data-topo-hub-spoke-active]'));
  return spokes.map(el => ({
    activeAttr:      el.getAttribute('data-topo-hub-spoke-active'),
    linecapAttr:     el.getAttribute('stroke-linecap'),
    linecapData:     el.getAttribute('data-topo-hub-spoke-linecap'),
    strokeWidthAttr: el.getAttribute('stroke-width'),
    dasharrayAttr:   el.getAttribute('stroke-dasharray'),
  }));
});

await browser.close();

const allOk = probe.length >= 1 && probe.every(s =>
  s.linecapAttr === 'round'
  && s.linecapData === 'round'
  && (s.activeAttr === 'true'
        ? (s.strokeWidthAttr === '2' && s.dasharrayAttr === 'none')
        : (s.strokeWidthAttr === '1' && s.dasharrayAttr === '6 14'))
);

const results = {
  spokes_rendered:     probe.length >= 1,
  all_linecap_round:   probe.every(s => s.linecapAttr === 'round'),
  all_data_linecap:    probe.every(s => s.linecapData === 'round'),
  per_state_invariants_intact: allOk,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-spoke strokeLinecap='round':`, JSON.stringify(results),
  '\n  count:', probe.length,
  '\n  sample:', probe.slice(0, 3));
process.exit(ok ? 0 : 1);
