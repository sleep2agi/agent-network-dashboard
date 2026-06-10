import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3500);
const chatButtons = await page.locator('.anet-agent-card button:has-text("Chat")').count();
const card = page.locator('.anet-agent-card:not([class*="opacity-40"])').first();
await card.click();
await page.waitForTimeout(1200);
const url = page.url();
await page.screenshot({ path: '/tmp/anet-mobile-qa/m2-tap-chat.png', animations: 'disabled', fullPage: false });
console.log(`Chat buttons left: ${chatButtons} — after tap url: ${url} (still / ⇒ popover opened, /node ⇒ navigated)`);
await browser.close();
