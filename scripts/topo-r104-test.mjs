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
await page.evaluate(() => { const h=[...document.querySelectorAll('h2')].find(x=>/Command mesh/i.test(x.textContent||'')); h?.scrollIntoView({behavior:'instant',block:'center'}); });
await page.waitForTimeout(400);
const scaleOf = () => page.evaluate(() => {
  const g = document.querySelector('svg[viewBox="0 0 1000 680"] > g[transform^="translate"]');
  const m = g?.getAttribute('transform')?.match(/scale\(([\d.]+)\)/);
  return m ? parseFloat(m[1]) : null;
});
const svgBox = await page.locator('svg[viewBox="0 0 1000 680"]').boundingBox();
const cx = svgBox.x + svgBox.width/2, cy = svgBox.y + svgBox.height/2;

// single wheel tick (deltaY -100, typical mouse notch)
await page.mouse.move(cx, cy);
const s0 = await scaleOf();
await page.mouse.wheel(0, -100);
await page.waitForTimeout(150);
const s1 = await scaleOf();
console.log('one wheel notch (-100): scale', s0, '->', s1, '(' + ((s1/s0-1)*100).toFixed(1) + '% per notch)');

// reset button is now a separate icon button
await page.locator('button[aria-label="Reset view"]').click();
await page.waitForTimeout(150);
console.log('after reset-button click: scale', await scaleOf());

// % is now a plain span, not a button
const pctIsButton = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(s => /^\d+%$/.test(s.textContent?.trim()||''));
  return el ? el.tagName : 'NOT_FOUND';
});
console.log('zoom % element tag:', pctIsButton, '(expect SPAN)');

// zoom in twice then double-click to reset
await page.locator('button[aria-label="Zoom in"]').click();
await page.locator('button[aria-label="Zoom in"]').click();
await page.waitForTimeout(150);
console.log('after 2x zoom-in button: scale', await scaleOf());
await page.mouse.dblclick(cx, cy);
await page.waitForTimeout(150);
console.log('after double-click canvas: scale', await scaleOf(), '(expect 1)');

await browser.close();
console.log('done');
