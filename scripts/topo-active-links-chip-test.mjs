/* Round 42 verification: "X active links" chip in the header includes
 * "· last <relative>" when flow links exist, drops the `· last …` tail
 * when no flow links are present, and renders singular/plural correctly. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe({ msgs }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'grid');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = ['alpha', 'beta', 'gamma'].map(a => ({
      alias: a, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => {
    // The active-links chip is the LAST chip in the topo header row (after
    // pressure-bar + vendor + working/online). Match by `active link`.
    const spans = [...document.querySelectorAll('span')];
    return spans.find(s => /active link/.test(s.textContent || ''))?.textContent?.replace(/\s+/g, ' ').trim() || null;
  });
  await ctx.close();
  return text;
}

// 1. No messages → 0 active links, no "· last X" tail
const empty = await probe({ msgs: [] });
// 2. One message just now → 1 active link · last Ns ago
const recent = await probe({ msgs: [
  { from_alias: 'alpha', to_alias: 'beta', content: 'hi', created_at: new Date(Date.now() - 30 * 1000).toISOString() },
] });
// 3. Five messages, latest 4 min ago → 5 active links · last 4m ago (singular link uses "link", plural "links")
const fourMinAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
const eightMinAgo = new Date(Date.now() - 8 * 60 * 1000).toISOString();
const five = await probe({ msgs: [
  { from_alias: 'alpha', to_alias: 'beta',  content: '1', created_at: eightMinAgo },
  { from_alias: 'alpha', to_alias: 'gamma', content: '2', created_at: eightMinAgo },
  { from_alias: 'alpha', to_alias: 'gamma', content: '3', created_at: eightMinAgo },
  { from_alias: 'beta',  to_alias: 'gamma', content: '4', created_at: eightMinAgo },
  { from_alias: 'beta',  to_alias: 'gamma', content: '5', created_at: fourMinAgo }, // latest
] });

await browser.close();
const results = {
  emptyChipHasNoTail: empty === '0 active links',
  recentSingularChip: recent !== null && /^1 active link · last \d+s ago$/.test(recent),
  pluralChipShowsLatest: five !== null && /active links · last [34]m ago/.test(five),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links chip:`, JSON.stringify(results),
  `\n  empty=${JSON.stringify(empty)}\n  recent=${JSON.stringify(recent)}\n  five=${JSON.stringify(five)}`);
process.exit(ok ? 0 : 1);
