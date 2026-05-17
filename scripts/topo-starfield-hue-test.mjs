/* Round 523 verification: starfield gains 3-hue deterministic color
 * rotation (indigo / cyan / slate) instead of flat #a5b4fc. 配色 family
 * 3rd anchor (cyber theme; light theme unaffected per starfield gate).
 *
 * Test phases:
 *   1. cyber: 14 dots present, each carries data-topo-starfield-dot-hue
 *      with one of: indigo / cyan / slate
 *   2. distribution: dots at i % 3 === 0 → indigo (#a5b4fc),
 *      i % 3 === 1 → cyan (#67e8f9), i % 3 === 2 → slate (#cbd5e1)
 *      → 14 dots → 5 indigo + 5 cyan + 4 slate (indices 0..13)
 *   3. all three hues present
 *   4. light theme: starfield not rendered at all (existing gate)
 *   5. source-side regex confirms hues array + dot-hue attr wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe(theme) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('anet-theme', t);
      localStorage.setItem('anet-topo-layout', 'ring');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, theme);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1')] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('svg[data-topo-layout]', { timeout: 15000 });
  await page.waitForTimeout(800);
  const data = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('[data-topo-starfield-dot]'));
    return dots.map((el) => ({
      idx:  el.getAttribute('data-topo-starfield-dot'),
      hue:  el.getAttribute('data-topo-starfield-dot-hue'),
      fill: el.getAttribute('fill'),
    }));
  });
  await browser.close();
  return data;
}

const cyber = await probe('cyber');
const light = await probe('light');

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHuesArr =
  /const hues = \['#a5b4fc', '#67e8f9', '#cbd5e1'\] as const;/.test(src);
const sourceNamesArr =
  /const hueNames = \['indigo', 'cyan', 'slate'\] as const;/.test(src);
const sourceAttrWired =
  /data-topo-starfield-dot-hue=\{hueNames\[hueIdx\]\}/.test(src);

// Cyber: 14 dots, distribution by i % 3
const cyberHueCounts = { indigo: 0, cyan: 0, slate: 0 };
for (const d of cyber) {
  if (d.hue && cyberHueCounts[d.hue] !== undefined) cyberHueCounts[d.hue]++;
}

// Verify each idx has the right hue per i % 3
const cyberIdxMatch = cyber.every((d) => {
  const i = parseInt(d.idx, 10);
  const expected = ['indigo', 'cyan', 'slate'][i % 3];
  return d.hue === expected;
});

// Verify fill matches the hue
const cyberFillMatch = cyber.every((d) => {
  const expectedFill = { indigo: '#a5b4fc', cyan: '#67e8f9', slate: '#cbd5e1' }[d.hue];
  return d.fill === expectedFill;
});

const results = {
  cyber_dot_count_14:        cyber.length === 14,
  cyber_indigo_count_5:      cyberHueCounts.indigo === 5,  // i=0,3,6,9,12 → 5
  cyber_cyan_count_5:        cyberHueCounts.cyan === 5,    // i=1,4,7,10,13 → 5
  cyber_slate_count_4:       cyberHueCounts.slate === 4,   // i=2,5,8,11 → 4
  cyber_idx_to_hue_match:    cyberIdxMatch,
  cyber_hue_to_fill_match:   cyberFillMatch,
  light_starfield_empty:     light.length === 0,
  source_hues_array:         sourceHuesArr,
  source_names_array:        sourceNamesArr,
  source_attr_wired:         sourceAttrWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R523 starfield 3-hue rotation:`,
  JSON.stringify(results, null, 2),
  '\n  cyber distribution:', JSON.stringify(cyberHueCounts),
  '\n  light count:', light.length);
process.exit(ok ? 0 : 1);
