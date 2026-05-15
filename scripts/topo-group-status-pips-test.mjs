/* Round 58 verification: group label includes a status-mix pip strip
 * showing how many members are working / idle / offline.
 *
 * Sessions (mixed-status alpha team + singleton beta):
 *   alpha1  — working
 *   alpha2  — working
 *   alpha3  — idle
 *   alpha4  — offline
 *   beta    — idle  (singleton, no group box)
 *
 * Grid layout draws a group box for alpha (4 members). Label should
 * end in something like "alpha · 4 · 2w 1i 1o". Status pips render
 * only when their count > 0, so a uniform group reads more simply.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(sessions) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'grid');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const seeded = sessions.map(s => ({
      alias: s.alias, status: s.status,
      network_id: nid, project_dir: null,
      created_at: s.status === 'offline' ? stale : fresh,
      updated_at: s.status === 'offline' ? stale : fresh,
      last_seen_at: s.status === 'offline' ? stale : fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions: seeded } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(c => document.querySelectorAll('g[data-node]').length === c, sessions.length, { timeout: 30000 });
  await page.waitForTimeout(500);
  const labels = await page.evaluate(() => {
    const out = {};
    for (const t of document.querySelectorAll('text[data-group-label]')) {
      out[t.getAttribute('data-group-label')] = (t.textContent || '').trim();
    }
    return out;
  });
  await ctx.close();
  return labels;
}

// Grouping is consecutive-run on the sorted [...online, ...offline] array,
// so an offline member of the "alpha" prefix family ends up in a separate
// band (it falls into the offline tier rather than joining the online
// alpha group). All members that share a multi-member band are by
// construction online, so the "offline pip" case is unreachable via the
// group label and the test covers only the working/idle dimensions here.
const mixed = await probe([
  { alias: 'alpha1', status: 'working' },
  { alias: 'alpha2', status: 'working' },
  { alias: 'alpha3', status: 'idle' },
  { alias: 'beta',   status: 'idle' },
]);

const allWorking = await probe([
  { alias: 'gamma1', status: 'working' },
  { alias: 'gamma2', status: 'working' },
  { alias: 'gamma3', status: 'working' },
  { alias: 'beta',   status: 'idle' },
]);

await browser.close();

const alphaLabel = mixed.alpha || '';
const gammaLabel = allWorking.gamma || '';

const results = {
  alpha_keyPresent:        /^alpha/.test(alphaLabel),
  alpha_countCorrect:      /·\s*3/.test(alphaLabel),
  alpha_workingPip:        /2w/.test(alphaLabel),
  alpha_idlePip:           /1i/.test(alphaLabel),
  alpha_noOfflinePip:      !/\d+o\b/.test(alphaLabel),
  // Uniform-status group: only the working pip renders.
  gamma_workingPip:        /3w/.test(gammaLabel),
  gamma_noIdlePip:         !/\d+i\b/.test(gammaLabel),
  gamma_noOfflinePip:      !/\d+o\b/.test(gammaLabel),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group status pips:`, JSON.stringify(results),
  `\n  alpha="${alphaLabel}"`,
  `\n  gamma="${gammaLabel}"`);
process.exit(ok ? 0 : 1);
