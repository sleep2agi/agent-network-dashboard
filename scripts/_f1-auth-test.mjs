import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

// Scenario 1: valid cookie, EMPTY sessionStorage (= new tab) — must stay on Overview
const ctx1 = await browser.newContext({ ...devices['iPhone 13'] });
await ctx1.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
const p1 = await ctx1.newPage();
await p1.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p1.waitForTimeout(3500);
const cards = await p1.locator('.anet-agent-card').count();
console.log(`S1 cookie-only new tab → url=${p1.url()} agentCards=${cards} (expect / + cards>0)`);

// Scenario 2: no cookie — middleware must redirect to /login
const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
const p2 = await ctx2.newPage();
await p2.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p2.waitForTimeout(1500);
console.log(`S2 no cookie → url=${p2.url()} (expect /login)`);
await browser.close();
