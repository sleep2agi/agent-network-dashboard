/* R41 — verify TopoGraph mobile soft cap. Tap Show Topology, screenshot. */
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
await page.waitForFunction(() => /Show Topology/.test(document.body.innerText), { timeout: 15000 });
await page.waitForTimeout(800);
// Tap Show Topology
const btn = await page.getByRole('button', { name: 'Show Topology' });
await btn.scrollIntoViewIfNeeded();
await btn.click();
await page.waitForTimeout(1200);
// Shot the toggle area: scroll to button so we frame the SVG cap
await page.getByRole('button', { name: 'Hide Topology' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r41-topo-shown.png', animations: 'disabled', fullPage: false });
console.log('R41 → /tmp/anet-mobile-qa/r41-topo-shown.png');
await browser.close();
