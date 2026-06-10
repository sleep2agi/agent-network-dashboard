import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'light'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/settings', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const html = document.documentElement;
  const probe = document.querySelector('.bg-\\[\\#111128\\]');
  return {
    dataTheme: html.getAttribute('data-theme'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bgVar: getComputedStyle(html).getPropertyValue('--bg'),
    probeBg: probe ? getComputedStyle(probe).backgroundColor : 'n/a',
    sheets: [...document.styleSheets].map(s => { try { return [...s.cssRules].filter(r => r.cssText.includes('data-theme="light"')).length; } catch { return -1; } }),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
