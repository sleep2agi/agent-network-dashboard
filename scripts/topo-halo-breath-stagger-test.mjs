/* Round 226 verification: working-halo breath gets per-node phase
 * stagger via SMIL `begin="-{nodeIdx * 0.37 % 3}s"`. Pre-R226 all
 * working halos pulsed in lockstep at the same instant; R226 desyncs
 * them organically.
 *
 * Test: 4 working agents → probe each [data-node-halo-breath='on']
 * circle for its `<animate>` child's `begin` attribute. Expect:
 *   - Each animate has a `begin` matching '-N.NNNs'
 *   - All four offsets are distinct (no two halos start at the
 *     same phase)
 *   - The data-node-halo-breath-offset attribute matches the
 *     `begin` magnitude (post-strip of '-' and 's')
 *   - The dur stays '3s' (period unchanged, only phase shifts)
 *   - Reduced-motion test scope unchanged (gate still keeps SMIL
 *     out for prefers-reduced-motion users)
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('[data-node-halo-breath="on"]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const out = await page.evaluate(() => {
  const halos = Array.from(document.querySelectorAll('[data-node-halo-breath="on"]'));
  return halos.map((h) => {
    const anim = h.querySelector('animate');
    return {
      offsetAttr: h.getAttribute('data-node-halo-breath-offset'),
      begin:      anim?.getAttribute('begin') || null,
      dur:        anim?.getAttribute('dur') || null,
      attrName:   anim?.getAttribute('attributeName') || null,
    };
  });
});
await browser.close();

const beginRe = /^-(\d+\.\d{3})s$/;
const parsed = out.map((h) => {
  const m = (h.begin || '').match(beginRe);
  return {
    ...h,
    beginNum: m ? parseFloat(m[1]) : NaN,
  };
});

// Expected: 4 halos, offsets (0 * 0.37) % 3, (1 * 0.37) % 3, etc.
// = 0.000, 0.370, 0.740, 1.110 (each .toFixed(3))
const expected = [0, 0.37, 0.74, 1.11];
const close = (a, b) => Math.abs(a - b) < 0.005;

const results = {
  four_halos:           parsed.length === 4,
  all_have_begin:       parsed.every(p => !Number.isNaN(p.beginNum)),
  all_have_dur_3s:      parsed.every(p => p.dur === '3s'),
  all_attr_opacity:     parsed.every(p => p.attrName === 'opacity'),
  all_offsets_distinct: new Set(parsed.map(p => p.beginNum)).size === 4,
  offsets_match_golden: parsed.every((p, i) => close(p.beginNum, expected[i])),
  attr_matches_begin:   parsed.every((p) => p.offsetAttr === p.beginNum.toFixed(3)),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} halo breath stagger:`, JSON.stringify(results),
  '\n  parsed:', parsed);
process.exit(ok ? 0 : 1);
