/* Round 474 verification: recent-row TEXT (alias / count / preview)
 * transition cadence sync 150ms → 200ms. R472 lifted the row TINT
 * RECT to 200ms but the text alongside still ran 150ms; R474 closes
 * that internal recent-row scope desync.
 *
 * Contract:
 *   - every <text data-recent-row-text-transition='200ms'> renders
 *     for each active recent-signal row
 *   - inline style includes 'fill 200ms ease-out' AND 'letter-
 *     spacing 200ms ease-out'
 *   - computed transitionDuration is '0.2s, 0.2s'
 *   - source-file conditional wired
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
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
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
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('b·1', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: {
  messages: [
    { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 'ping',  created_at: fresh },
    { id: 'm2', from_alias: 'b·1', to_alias: 'a·1', content: 'pong',  created_at: fresh },
    { id: 'm3', from_alias: 'a·2', to_alias: 'b·1', content: 'reply', created_at: fresh },
  ],
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-row-text-transition]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const texts = [...document.querySelectorAll('[data-recent-row-text-transition]')];
  return {
    count: texts.length,
    nodes: texts.map(t => {
      const cs = getComputedStyle(t);
      return {
        attr:     t.getAttribute('data-recent-row-text-transition'),
        style:    t.getAttribute('style') || '',
        duration: cs.transitionDuration,
      };
    }),
  };
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceAttr  = /data-recent-row-text-transition="200ms"/.test(src);
const sourceStyle = /'fill 200ms ease-out, letter-spacing 200ms ease-out'/.test(src);

await browser.close();

const countGe1     = probe.count >= 1;
const allAttr200   = probe.nodes.every(n => n.attr === '200ms');
const allStyle200  = probe.nodes.every(n =>
  /fill 200ms ease-out/.test(n.style) && /letter-spacing 200ms ease-out/.test(n.style));
const allDur200    = probe.nodes.every(n => /(^|, )0\.2s/.test(n.duration));
const noLegacy150  = probe.nodes.every(n =>
  !/fill 150ms/.test(n.style) && !/letter-spacing 150ms/.test(n.style));

const results = {
  text_count_ge_1:        countGe1,
  all_attr_200:           allAttr200,
  all_style_200:          allStyle200,
  all_computed_200:       allDur200,
  no_legacy_150_in_dom:   noLegacy150,
  source_attr:            sourceAttr,
  source_style:           sourceStyle,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row text cadence 150→200:`, JSON.stringify(results),
  '\n  count:', probe.count,
  '\n  first:', JSON.stringify(probe.nodes[0]));
process.exit(ok ? 0 : 1);
