/* Round 479 verification: group-label parent text gains filter:
 * drop-shadow glow on isPinned. 4th anchor in the R476/R477/R478
 * drop-shadow visual-polish family.
 *
 * Contract:
 *   - at rest (no group pinned): every group label has data-group-
 *     label-glow='false' AND computed filter === 'none'
 *   - click a group-label hitbox: that group's label flips to
 *     glow='true' + filter starts with 'drop-shadow' using
 *     pal.legendAccent at 0x80 alpha
 *   - sibling group labels stay rest (no spillover)
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
    localStorage.setItem('anet-topo-layout', 'grid');
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
    mk('alpha·1', 'working'), mk('alpha·2', 'idle'),
    mk('beta·1',  'working'), mk('beta·2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label-glow]', { timeout: 15000 });
await page.waitForTimeout(500);

const readAll = () => page.evaluate(() => {
  const labels = [...document.querySelectorAll('[data-group-label-glow]')];
  return labels.map(l => {
    const cs = getComputedStyle(l);
    return {
      key:    l.getAttribute('data-group-label'),
      glow:   l.getAttribute('data-group-label-glow'),
      filter: cs.filter,
    };
  });
});

const rest = await readAll();
const firstKey = rest[0]?.key;

// Click hitbox to pin the first group
let pinned = null;
if (firstKey) {
  const hit = await page.$(`[data-group-label-hit="${firstKey}"]`);
  if (hit) {
    await hit.click();
    await page.waitForTimeout(400);
    pinned = await readAll();
  }
}

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGlowAttr = /data-group-label-glow=\{isPinned/.test(src);
const sourceDropShadow = /drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\)/.test(src);

await browser.close();

const restCount     = rest.length;
const restAllFalse  = rest.every(r => r.glow === 'false' && r.filter === 'none');
const pinnedTarget  = pinned?.find(r => r.key === firstKey);
const pinTargetGlow = pinnedTarget?.glow === 'true';
const pinTargetHasShadow = pinnedTarget && /drop-shadow/.test(pinnedTarget.filter);
const pinSiblingsStill = pinned ? pinned.filter(r => r.key !== firstKey).every(r => r.glow === 'false') : false;

const results = {
  rest_count_ge_2:     restCount >= 2,
  rest_all_false:      restAllFalse,
  pinned_target_glow:  pinTargetGlow,
  pinned_target_shadow: pinTargetHasShadow,
  pinned_siblings_rest: pinSiblingsStill,
  source_glow_attr:    sourceGlowAttr,
  source_drop_shadow:  sourceDropShadow,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-label drop-shadow glow:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned target:', JSON.stringify(pinnedTarget));
process.exit(ok ? 0 : 1);
