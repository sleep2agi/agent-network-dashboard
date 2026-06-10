import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {} });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3500);
const m = await page.evaluate(() => {
  const card = document.querySelector('.anet-agent-card');
  if (!card) return null;
  const r = card.getBoundingClientRect();
  const kids = [...card.children].map(c => ({ cls: c.className.toString().slice(0, 40), h: Math.round(c.getBoundingClientRect().height) }));
  return { cardH: Math.round(r.height), kids, html: card.innerHTML.slice(0, 100) };
});
console.log(JSON.stringify(m, null, 1));
await browser.close();
