/* Round 458 verification: status pip strip fontSize 11 → 8 + dx
 * 8/4/4 → 6/3/3, to scale-match the new 9px label that N站牛/codex
 * preview.125 shipped (Hero D #147 Option C: label fontSize 13→9,
 * opacity 0.55 rest / 1 hover+pin, count tspan 11→8). R458 closes
 * the pip-strip leg of the same family.
 *
 * Contract:
 *   - every <tspan data-group-pip="working|idle|offline">
 *     reports font-size '8' (down from '11')
 *   - source-file dx values for the 3 pips are '6'/'3'/'3'
 *     (down from '8'/'4'/'4')
 *   - parent <text data-group-label> font-size stays '9' (codex
 *     preview.125 baseline preserved — R458 is a follow-on, not a
 *     replacement)
 *   - count tspan font-size stays '8' (codex preview.125 baseline)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
// Fixture: 2 prefix groups, each MIXED (so at least one pip
// renders — R319 drops pips when count===box.count).
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
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('alpha·3', 'offline'),
    mk('beta·1',  'working'),
    mk('beta·2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const pips = [...document.querySelectorAll('[data-group-pip]')].map(t => ({
    tier: t.getAttribute('data-group-pip'),
    fontSize: t.getAttribute('font-size'),
    text: t.textContent,
  }));
  const labels = [...document.querySelectorAll('[data-group-label]')].map(t => ({
    key: t.getAttribute('data-group-label'),
    fontSize: t.getAttribute('font-size'),
  }));
  const counts = [...document.querySelectorAll('[data-group-label-count]')].map(t => ({
    key: t.getAttribute('data-group-label-count'),
    fontSize: t.getAttribute('font-size'),
  }));
  return { pips, labels, counts };
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// dx values for the 3 pips — the source file uses dx="6" then dx="3" twice
const dxWorking = /data-group-pip="working"[\s\S]{0,400}?dx="6"/.test(src) ||
                  /dx="6"[\s\S]{0,400}?data-group-pip="working"/.test(src);
const dxIdle    = /data-group-pip="idle"[\s\S]{0,400}?dx="3"/.test(src) ||
                  /dx="3"[\s\S]{0,400}?data-group-pip="idle"/.test(src);
const dxOffline = /data-group-pip="offline"[\s\S]{0,400}?dx="3"/.test(src) ||
                  /dx="3"[\s\S]{0,400}?data-group-pip="offline"/.test(src);

await browser.close();

const allPipsAre8 = probe.pips.length >= 2 && probe.pips.every(p => p.fontSize === '8');
const labelStays9 = probe.labels.length >= 2 && probe.labels.every(l => l.fontSize === '9');
const countStays8 = probe.counts.length >= 2 && probe.counts.every(c => c.fontSize === '8');

const results = {
  pips_count_ge_2:       probe.pips.length >= 2,
  pips_all_fontsize_8:   allPipsAre8,
  labels_stay_9:         labelStays9,
  counts_stay_8:         countStays8,
  dx_working_is_6:       dxWorking,
  dx_idle_is_3:          dxIdle,
  dx_offline_is_3:       dxOffline,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group pip fontSize scale-match:`, JSON.stringify(results),
  '\n  pips:', JSON.stringify(probe.pips),
  '\n  labels:', JSON.stringify(probe.labels),
  '\n  counts:', JSON.stringify(probe.counts));
process.exit(ok ? 0 : 1);
