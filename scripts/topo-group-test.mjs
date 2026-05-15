import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme','cyber'); localStorage.removeItem('anet-topo-view'); sessionStorage.setItem('anet_v3_auth','1'); } catch {} });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
// for each node: alias + avatar bg fill — same prefix should share fill
const map = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const nodeGs = [...svg.querySelectorAll('g')].filter(g =>
    g.querySelector(':scope > circle[r="26"], :scope > circle[r="18"]') &&
    g.querySelector(':scope > g > text[font-weight="700"]'));
  return nodeGs.map(g => {
    const label = g.querySelector(':scope > g > text[font-weight="700"]').textContent.trim();
    // avatar bg circle: the small circle that is NOT the status ring (r 26/18) and NOT inner — it's r=14/10 with a fill
    const avatarCircle = [...g.querySelectorAll(':scope > circle')].find(c => {
      const r = parseFloat(c.getAttribute('r'));
      return (r === 14 || r === 10) && c.getAttribute('fill') && c.getAttribute('fill').startsWith('hsl');
    });
    return { alias: label, fill: avatarCircle ? avatarCircle.getAttribute('fill') : null };
  });
});
// group by fill
const byFill = {};
map.forEach(({alias, fill}) => { (byFill[fill] ??= []).push(alias); });
console.log('avatar fill → aliases:');
Object.entries(byFill).forEach(([fill, aliases]) => console.log('  ' + fill + ': ' + aliases.join(', ')));
await page.locator('section:has(h2:text("Command mesh"))').screenshot({ path: '/tmp/anet-issue-50/topo-grouped.png' });
await browser.close();
console.log('done');
