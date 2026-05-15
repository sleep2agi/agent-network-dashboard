/* Round 37 verification: ChatPopover header carries cwd / last-seen
 * lines pulled from the SWR session cache. Three cases:
 *   - online node with cwd → cwd line, no last-seen
 *   - offline node with cwd → both lines
 *   - bare node (no cwd, no last_seen) → drag/Esc fallback hint */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(targetAlias) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'grid');
      localStorage.setItem('anet-topo-nodescale', '1');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  const offline = new Date(Date.now() - 8 * 60 * 1000).toISOString(); // 8 min ago
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = [
      { alias: 'liveCwd', status: 'idle', network_id: nid,
        project_dir: '/home/vansin/agent-orchestra',
        created_at: fresh, updated_at: fresh, last_seen_at: fresh },
      { alias: 'offCwd', status: 'offline', network_id: nid,
        project_dir: '/home/vansin/some-project',
        created_at: fresh, updated_at: fresh, last_seen_at: offline },
      { alias: 'bare', status: 'idle', network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    ];
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.locator(`g[data-node="${targetAlias}"]`).click();
  await page.waitForTimeout(300);
  const meta = await page.evaluate(() => {
    const cwd = document.querySelector('[data-popover-cwd]');
    const ls = document.querySelector('[data-popover-lastseen]');
    const popover = document.querySelector('[aria-label^="Chat with"]');
    const dragHint = popover ? [...popover.querySelectorAll('div')].find(d => /Drag to move/.test(d.textContent || '')) : null;
    return {
      cwdText: cwd?.textContent || null,
      lsText: ls?.textContent || null,
      dragHintPresent: !!dragHint,
    };
  });
  await ctx.close();
  return meta;
}

const live = await probe('liveCwd');
const off = await probe('offCwd');
const bare = await probe('bare');
await browser.close();

const results = {
  liveShowsCwd: live.cwdText === 'cwd: /home/vansin/agent-orchestra' && live.lsText === null && !live.dragHintPresent,
  offlineShowsBoth: off.cwdText === 'cwd: /home/vansin/some-project'
    && /last seen: [78]m ago/.test(off.lsText || '')
    && !off.dragHintPresent,
  bareFallsBackToDragHint: bare.cwdText === null && bare.lsText === null && bare.dragHintPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} popover meta:`, JSON.stringify(results),
  `\n  live=`, live, `\n  off=`, off, `\n  bare=`, bare);
process.exit(ok ? 0 : 1);
