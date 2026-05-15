/* Round 71 verification: each active-filter pill shows a "· N" match
 * count tail and surfaces `data-filter-match-count` for tooling.
 *
 * Sessions: 1 working + 2 idle + 1 offline + 3-alpha cluster.
 *   Pin status=working → pill "filter: working · 1", count=1
 *   Pin status=idle    → pill "filter: idle · 5",    count=5 (idl + alpha1/2/3 all idle online)
 *   Pin status=offline → pill "filter: offline · 1", count=1
 *   Pin group=alpha    → pill "filter: alpha · 3",   count=3 (3 alphas)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'wkr',    status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl',    status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl2',   status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha1', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha2', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha3', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'off',    status: 'offline', network_id: nid, project_dir: null, created_at: stale, updated_at: stale, last_seen_at: stale },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 7, { timeout: 30000 });
await page.waitForTimeout(700);

async function pin({ status, group }) {
  await page.evaluate(({ status, group }) => {
    if (status === null) { sessionStorage.removeItem('anet-topo-pinned-status'); }
    else { sessionStorage.setItem('anet-topo-pinned-status', status); }
    if (group === null) { sessionStorage.removeItem('anet-topo-pinned-group'); }
    else if (group) { sessionStorage.setItem('anet-topo-pinned-group', group); }
    window.dispatchEvent(new CustomEvent('anet:topo-pin',
      { detail: status !== undefined ? { kind: 'status', value: status }
              : group !== undefined ? { kind: 'group',  value: group }
              : { kind: 'clear' } }));
  }, { status, group });
  await page.waitForTimeout(250);
}

const readPill = (kind) => page.evaluate(k => {
  const el = document.querySelector(`[data-active-filter="${k}"]`);
  if (!el) return null;
  return {
    text:  (el.innerText || el.textContent || '').trim(),
    count: el.getAttribute('data-filter-match-count'),
  };
}, kind);

// Pin working → 1 match.
await pin({ status: 'working' });
const w = await readPill('status');

// Pin idle → 5 (idl + idl2 + alpha1 + alpha2 + alpha3 — all idle online).
await pin({ status: 'idle' });
const i = await readPill('status');

// Pin offline → 1 match.
await pin({ status: 'offline' });
const o = await readPill('status');

// Pin group alpha → 3 match.
await pin({ status: null });
await pin({ group: 'alpha' });
const g = await readPill('group');

await browser.close();

const results = {
  working_attrCount1:  w && w.count === '1',
  working_textHas1:    w && /·\s*1\b/.test(w.text),
  idle_attrCount5:     i && i.count === '5',
  idle_textHas5:       i && /·\s*5\b/.test(i.text),
  offline_attrCount1:  o && o.count === '1',
  offline_textHas1:    o && /·\s*1\b/.test(o.text),
  group_attrCount3:    g && g.count === '3',
  group_textHas3:      g && /·\s*3\b/.test(g.text),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pill count:`, JSON.stringify(results),
  `\n  working=`, w,
  `\n  idle=`,    i,
  `\n  offline=`, o,
  `\n  group=`,   g);
process.exit(ok ? 0 : 1);
