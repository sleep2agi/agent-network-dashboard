import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme','cyber'); localStorage.removeItem('anet-brand'); localStorage.removeItem('anet-topo-view'); sessionStorage.setItem('anet_v3_auth','1'); } catch {} });
// inject a 书生 fleet alongside the real sessions
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch(); const b = await r.json();
  const real = b.sessions || [];
  const fleet = Array.from({length: 8}, (_, i) => ({
    alias: `书生${i+1}号`, status: i % 3 === 0 ? 'working' : 'idle',
    network_id: real[0]?.network_id || 'default',
    created_at:'2026-05-14T00:00:00Z', updated_at:'2026-05-14T00:00:00Z', last_seen_at:'2026-05-14T00:00:00Z',
  }));
  await route.fulfill({ response: r, json: { ...b, sessions: [...real, ...fleet] } });
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });  // NO ?brand=intern
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('circle[r="26"]').length >= 14;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1000);
const result = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const nodeGs = [...svg.querySelectorAll('g')].filter(g =>
    g.querySelector(':scope > circle[r="26"], :scope > circle[r="18"]') &&
    g.querySelector(':scope > g > text[font-weight="700"]'));
  let internWithImage = 0, internWithoutImage = 0, nonInternWithImage = 0, nonInternGeneric = 0;
  const samples = [];
  nodeGs.forEach(g => {
    const alias = g.querySelector(':scope > g > text[font-weight="700"]').textContent.trim();
    const hasImage = !!g.querySelector(':scope > image[href*="intern_avatar"]');
    const isIntern = /书生|书小生|intern/i.test(alias);
    if (isIntern && hasImage) internWithImage++;
    else if (isIntern && !hasImage) { internWithoutImage++; samples.push('MISS:'+alias); }
    else if (!isIntern && hasImage) { nonInternWithImage++; samples.push('LEAK:'+alias); }
    else nonInternGeneric++;
  });
  return { internWithImage, internWithoutImage, nonInternWithImage, nonInternGeneric, samples };
});
console.log(JSON.stringify(result, null, 1));
await page.locator('section:has(h2:text("Command mesh"))').screenshot({ path: '/tmp/anet-issue-50/intern-alias-cyber.png' });
await browser.close();
console.log('done');
