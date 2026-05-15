/* Round 216 verification: outer-ring orbit particle opacity scales
 * with busy bucket alongside R131's speed scaling. Idle fleet → dim
 * particles; busy fleet → bright. transitions on opacity 300ms.
 *
 * Bucket map: workingCount 0 → busy 0; 1-2 → 1; 3-5 → 2; 6+ → 3
 *             opacity      [0.5, 0.7, 0.85, 1.0]
 *
 * Test scenarios (cyber dark, orbit particles only render in dark):
 *   A. 0 working sessions (4 idle):   busy=0, opacity≈0.5
 *   B. 2 working sessions (2 working+2 idle):  busy=1, opacity≈0.7
 *   C. 6 working sessions:            busy=3, opacity≈1.0
 *   Every orbit particle has style.transition: 'opacity 300ms'
 *   Every orbit <g> exposes data-topo-orbit-opacity matching the
 *   bucket value (test verifies derivation + DOM agreement).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function pageFor(workingN) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  const totalSessions = Math.max(workingN, 4);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias, status) => ({
      alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    const sessions = [];
    for (let i = 0; i < totalSessions; i++) {
      sessions.push(mk(`node-${(i + 1).toString().padStart(2, '0')}`, i < workingN ? 'working' : 'idle'));
    }
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, totalSessions, { timeout: 30000 });
  await page.waitForSelector('[data-topo-orbit-bucket]', { timeout: 10000, state: 'attached' });
  await page.waitForTimeout(300);
  return page;
}

const probe = async (page) => page.evaluate(() => {
  return [...document.querySelectorAll('[data-topo-orbit-bucket]')].map(el => {
    const inner = el.querySelector('circle');
    return {
      bucket:        el.getAttribute('data-topo-orbit-bucket'),
      bucketOpacity: el.getAttribute('data-topo-orbit-opacity'),
      dur:           el.getAttribute('data-topo-orbit-dur'),
      circleOpacity: parseFloat(inner?.getAttribute('opacity') || ''),
      transition:    inner?.style.transition,
    };
  });
});

// Scenario A: 0 working → busy=0, opacity=0.5
const pageA = await pageFor(0);
const probeA = await probe(pageA);
await pageA.close();

// Scenario B: 2 working → busy=1, opacity=0.7
const pageB = await pageFor(2);
const probeB = await probe(pageB);
await pageB.close();

// Scenario C: 6 working → busy=3, opacity=1.0
const pageC = await pageFor(6);
const probeC = await probe(pageC);
await pageC.close();
await browser.close();

const near = (got, want, tol = 0.05) => Math.abs(got - want) < tol;
const hasOpacityT = (s) => /opacity\s+(?:300ms|0\.3s)/.test(s || '');

const results = {
  // 4 orbit particles in each scenario (R50 phase array of 4)
  A_four_particles:        probeA.length === 4,
  B_four_particles:        probeB.length === 4,
  C_four_particles:        probeC.length === 4,

  // Scenario A — idle fleet (busy=0)
  A_bucket_0:              probeA.every(p => p.bucket === '0'),
  A_opacity_half:          probeA.every(p => near(p.circleOpacity, 0.5)),
  A_data_attr_matches:     probeA.every(p => parseFloat(p.bucketOpacity) === p.circleOpacity),

  // Scenario B — light load (busy=1)
  B_bucket_1:              probeB.every(p => p.bucket === '1'),
  B_opacity_0p7:           probeB.every(p => near(p.circleOpacity, 0.7)),

  // Scenario C — heavy load (busy=3)
  C_bucket_3:              probeC.every(p => p.bucket === '3'),
  C_opacity_full:          probeC.every(p => near(p.circleOpacity, 1.0)),

  // Brightness actually grew across buckets
  brightness_grew:         probeA[0].circleOpacity < probeB[0].circleOpacity
                           && probeB[0].circleOpacity < probeC[0].circleOpacity,

  // Transitions present in every particle of every scenario
  A_all_have_transition:   probeA.every(p => hasOpacityT(p.transition)),
  B_all_have_transition:   probeB.every(p => hasOpacityT(p.transition)),
  C_all_have_transition:   probeC.every(p => hasOpacityT(p.transition)),

  // R131's existing speed scaling still derives — dur shortens as
  // bucket grows
  speed_scales:            parseFloat(probeA[0].dur || '0') > parseFloat(probeC[0].dur || '99'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} orbit opacity bucket:`, JSON.stringify(results),
  `\n  probeA (0 working):`, probeA.slice(0, 1),
  `\n  probeB (2 working):`, probeB.slice(0, 1),
  `\n  probeC (6 working):`, probeC.slice(0, 1));
process.exit(ok ? 0 : 1);
