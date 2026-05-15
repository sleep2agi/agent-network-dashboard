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
const ordered = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const cx = 500, cy = 330;
  // each agent node <g> contains: status-ring circle[r=26|18] + a label <g> with the alias text
  const nodeGs = [...svg.querySelectorAll('g')].filter(g => {
    return g.querySelector(':scope > circle[r="26"], :scope > circle[r="18"]') &&
           g.querySelector(':scope > g > text[font-weight="700"]');
  });
  const nodes = nodeGs.map(g => {
    const ring = g.querySelector(':scope > circle[r="26"], :scope > circle[r="18"]');
    const label = g.querySelector(':scope > g > text[font-weight="700"]');
    const x = parseFloat(ring.getAttribute('cx')), y = parseFloat(ring.getAttribute('cy'));
    return { alias: label.textContent.trim(), ang: Math.atan2(y - cy, x - cx) };
  });
  nodes.sort((a, b) => a.ang - b.ang);
  return nodes.map(n => n.alias);
});
console.log('node count:', ordered.length);
console.log('ring order (by angle):');
console.log(ordered.join(' · '));
// check 通信* contiguity
const tx = ordered.map((a, i) => a.startsWith('通信') ? i : -1).filter(i => i >= 0);
const contiguous = tx.length === 0 || tx.every((v, i) => i === 0 || v === tx[i-1] + 1) ||
  // allow wrap-around contiguity
  (() => { const n = ordered.length; const set = new Set(tx); for (let s = 0; s < n; s++) { let ok = true; for (let k = 0; k < tx.length; k++) if (!set.has((s + k) % n)) { ok = false; break; } if (ok) return true; } return false; })();
console.log('通信* indices:', tx.join(','), '→ contiguous:', contiguous);
await browser.close();
console.log('done');
