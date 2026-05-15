/* Round 112 verification: working-status nodes get a halo opacity
 * breath (SMIL <animate>) at 3s cycle. Idle + offline halos stay
 * flat. reducedMotion suppresses the breath entirely.
 *
 * Fleet: 1 working + 1 idle + 1 offline.
 *   wkr → data-node-halo-breath="on", child <animate> present
 *   idl → data-node-halo-breath="off", no <animate> child
 *   off → data-node-halo-breath="off", no <animate> child
 * Then probe reducedMotion=reduce → wkr also reads "off", no
 * <animate>.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const fresh   = new Date(Date.now() - 60 * 1000).toISOString();
const stale10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();

const probe = async (reducedMotion) => {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1500 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias, status, ts) => ({
      alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null,
      created_at: ts, updated_at: ts, last_seen_at: ts,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('wkr', 'working', fresh),
      mk('idl', 'idle',    fresh),
      mk('off', 'offline', stale10),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
  await page.waitForTimeout(400);
  const data = await page.evaluate(() => {
    const out = {};
    for (const a of ['wkr', 'idl', 'off']) {
      const g = document.querySelector(`g[data-node="${a}"]`);
      const halo = g?.querySelector('[data-node-halo-breath]');
      out[a] = {
        attr:  halo?.getAttribute('data-node-halo-breath') || '',
        anim: !!halo?.querySelector('animate'),
        dur:  halo?.querySelector('animate')?.getAttribute('dur') || null,
      };
    }
    return out;
  });
  await ctx.close();
  return data;
};

const normal  = await probe(false);
const reduced = await probe(true);
await browser.close();

const results = {
  normal_wkrAttrOn:     normal.wkr.attr === 'on',
  normal_wkrHasAnimate: normal.wkr.anim === true,
  normal_wkrDur3s:      normal.wkr.dur === '3s',
  normal_idlAttrOff:    normal.idl.attr === 'off',
  normal_idlNoAnimate:  normal.idl.anim === false,
  normal_offAttrOff:    normal.off.attr === 'off',
  normal_offNoAnimate:  normal.off.anim === false,
  reduced_wkrAttrOff:   reduced.wkr.attr === 'off',
  reduced_wkrNoAnimate: reduced.wkr.anim === false,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} working halo breath:`, JSON.stringify(results),
  `\n  normal=`,   normal,
  `\n  reduced=`,  reduced);
process.exit(ok ? 0 : 1);
