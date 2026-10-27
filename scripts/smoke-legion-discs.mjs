// Isolated visual/interaction regression for the c11 department-disc adapter.
// All API responses and portraits are fixtures; no Hub credentials or writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL || 'http://127.0.0.1:3126';
const output = process.env.OUTPUT_DIR;
assert(output, 'OUTPUT_DIR required');
assert.equal(new URL(base).hostname, '127.0.0.1');
assert(!['3101', '3102'].includes(new URL(base).port), 'Use a dedicated fixture preview');
const password = process.env.FIXTURE_PASSWORD || 'disc-fixture-only';
const longName = '星际协同研发与跨平台交互体验技术研究部门';
const person = (i, dept, agents = true) => ({ user_id: `fixture-person-${i}`, username: `fixture-person-${i}`,
  display_name: `模拟成员${i}`, role: 'member', department: dept,
  agents: agents ? [{ node_id: `fixture-agent-${i}`, alias: `fixture-agent-${i}` }] : [] });
const sparse = { departments: [{ id: 'sparse', name: longName }], people: [person(1, { id: 'sparse', name: longName })] };
const hierarchy = [{ id: 'root', name: '协同中心' }, { id: 'deep', name: '深层技术部门', parent_id: 'root' },
  { id: 'leaf', name: '三级验证部门', parent_id: 'deep' }, { id: 'empty', name: '空编制部门' }];
const denseDepts = Array.from({ length: 13 }, (_, i) => ({ id: `dense-${i}`, name: `第${String(i + 1).padStart(2, '0')}模拟部门` }));
const fixtures = {
  sparse,
  hierarchy: { departments: hierarchy, people: [person(1, hierarchy[0]), person(2, hierarchy[2])] },
  empty: { departments: hierarchy, people: [] },
  dense: { departments: denseDepts, people: Array.from({ length: 65 }, (_, i) => person(i, denseDepts[i % 13])) },
};
const checks = {}, snapshots = {}, errors = [];
const check = (name, value) => { checks[name] = !!value; };
const overlap = (b, r) => ((Math.max(r.x1, Math.min(b.x, r.x2)) - b.x) / b.rx) ** 2
  + ((Math.max(r.y1, Math.min(b.y, r.y2)) - b.y) / b.ry) ** 2 <= 1;
const almost = (a, b) => !!a && !!b && ['x', 'y', 'rx', 'ry'].every(k => Math.abs(a[k] - b[k]) < 0.5);
await mkdir(output, { recursive: true });
const source = await readFile(new URL(import.meta.url));
await writeFile(path.join(output, 'probe-used.mjs'), source);
const metadata = {
  base, fixture: true, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  probeSha256: createHash('sha256').update(source).digest('hex'),
  build: await fetch(`${base}/api/health`).then(r => r.json()),
};
assert.equal(metadata.sourceDirty, false, 'Evidence requires a clean tracked source tree, including staged changes');
assert.equal(metadata.build.commit, metadata.sourceCommit, 'Fixture build must match the source commit');
const browser = await chromium.launch({ headless: true });
const frames = (page, count = 4) => page.evaluate(count => new Promise(resolve => {
  let elapsed = 0;
  const next = () => { if (++elapsed >= count) resolve(); else requestAnimationFrame(next); };
  requestAnimationFrame(next);
}), count);

async function createPage(fixture, theme, width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(15000);
  await context.addCookies([{ name: 'anet_dashboard_session', url: base, httpOnly: true, sameSite: 'Lax',
    value: createHash('sha256').update(`anet-dashboard:${password}`).digest('hex') }]);
  await context.addInitScript(({ theme }) => {
    localStorage.setItem('anet-theme', theme);
    localStorage.setItem('anet-sidebar-mode', 'expanded');
    sessionStorage.setItem('anet_network_id', 'fixture');
    sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: { username: 'fixture', role: 'owner' },
      token: 'fixture-token', networks: [{ network_id: 'fixture', network_name: '模拟网络' }], currentNetwork: 'fixture' }));
    // Read real canvas draw calls. In particular, ellipse is not approximated
    // by an arc, and short names identify non-origin department positions.
    const proto = CanvasRenderingContext2D.prototype;
    const paths = new WeakMap();
    for (const method of ['setTransform', 'beginPath', 'arc', 'ellipse', 'moveTo', 'lineTo', 'roundRect', 'stroke', 'fillText', 'drawImage']) {
      const original = proto[method];
      proto[method] = function (...args) {
        if (this.canvas.getAttribute('aria-label') === '军团三维拓扑图') {
          if (method === 'setTransform' && args.join(',') === '1,0,0,1,0,0') {
            window.__discFrame = { shapes: [], texts: [], portraits: [], leaders: [], rects: [] };
          }
          const frame = window.__discFrame;
          if (frame) {
            if (method === 'beginPath') paths.set(this, {});
            const p = paths.get(this);
            if (method === 'arc' || method === 'ellipse') paths.set(this, {
              x: args[0], y: args[1], rx: args[2], ry: method === 'ellipse' ? args[3] : args[2], method });
            if (method === 'moveTo' && p) p.from = { x: args[0], y: args[1] };
            if (method === 'lineTo' && p) p.to = { x: args[0], y: args[1] };
            if (method === 'stroke' && p) {
              if (p.rx) frame.shapes.push({ ...p, color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha });
              if (this.lineWidth === 0.75 && p.from && p.to) frame.leaders.push({ from: p.from, to: p.to });
            }
            if (method === 'roundRect') frame.rects.push({ x1: args[0], y1: args[1], x2: args[0] + args[2], y2: args[1] + args[3] });
            if (method === 'fillText') frame.texts.push({ text: args[0], x: args[1], y: args[2], width: this.measureText(args[0]).width,
              font: this.font, color: this.fillStyle, alpha: this.globalAlpha });
            if (method === 'drawImage' && args[0] instanceof HTMLImageElement && args[0].src.includes('portrait-disc.svg')) {
              frame.portraits.push(args.slice(1));
            }
          }
        }
        return original.apply(this, args);
      };
    }
  }, { theme });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const json = url.pathname === '/api/hub/networks' ? { ok: true, networks: [{ network_id: 'fixture', network_name: '模拟网络' }] }
        : url.pathname === '/api/hub/people' ? { ok: true, network_id: 'fixture', people: fixture.people,
          total: fixture.people.length, has_more: false, agents_without_owner: [] }
        : url.pathname === '/api/hub/departments' ? { ok: true, network_id: 'fixture', departments: fixture.departments,
          members: fixture.people.map(p => ({ ...p, department_id: p.department?.id ?? null })) }
        : url.pathname === '/api/hub/status' ? { ok: true, sessions: fixture.people.flatMap(p => p.agents.map(a => ({ ...a, status: 'idle' }))) }
        : url.pathname === '/api/hub/health' ? { ok: true, version: 'fixture', sessions: 0, sse_sessions: {} }
        : { ok: true, nodes: [], stats: {}, messages: [] };
      return route.fulfill({ json });
    }
    if (url.pathname === '/avatars/manifest.json') return route.fulfill({ json: Object.fromEntries(
      fixture.people.flatMap(p => [p.username, ...p.agents.map(a => a.alias)]).map(a => [a, '/avatars/portrait-disc.svg'])) });
    if (url.pathname === '/avatars/portrait-disc.svg') return route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#247876"/><circle cx="32" cy="25" r="12" fill="#e8eddf"/><path d="M8 64a24 24 0 0 1 48 0" fill="#e8eddf"/></svg>' });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/legion/3d`, { waitUntil: 'networkidle' });
  await page.getByText(`${fixture.departments.length} 个部门 · ${fixture.people.length} 名成员 · ${fixture.people.reduce((n, p) => n + p.agents.length, 0)} 个 Agent`, { exact: true }).waitFor();
  const spin = page.getByTestId('legion-3d-spin');
  if (await spin.getAttribute('aria-pressed') === 'true') await spin.click();
  await page.mouse.move(1, 1);
  await frames(page, 32);
  return { page, context };
}

async function capture(page, tag, fixture) {
  await frames(page, 4);
  const frame = await page.evaluate(() => window.__discFrame);
  const colors = await page.evaluate(() => Object.fromEntries(['fg', 'fg-muted', 'accent'].map(k =>
    [k, getComputedStyle(document.documentElement).getPropertyValue(`--${k}`).trim().toLowerCase()])));
  const core = frame.shapes.filter(s => s.color === colors.accent && s.width >= 1.39).sort((a, b) => b.rx - a.rx)[0];
  const bodies = frame.shapes.filter(s => s.width >= 1.39 && (s === core || s.method === 'ellipse'
    || s.color === colors.fg || s.color === colors['fg-muted']));
  const discs = bodies.filter(s => s.method === 'ellipse');
  const canvas = await page.getByRole('img', { name: '军团三维拓扑图', exact: true }).boundingBox();
  const local = r => ({ x1: r.x - canvas.x, y1: r.y - canvas.y, x2: r.x + r.width - canvas.x, y2: r.y + r.height - canvas.y });
  const header = local(await page.getByTestId('legion-3d-header').boundingBox());
  const footer = local(await page.getByText(/^拖动环绕/).locator('..').boundingBox());
  check(`${tag}:discCount`, discs.length === fixture.departments.length);
  check(`${tag}:discAxesAndFloor`, discs.length && discs.every(b => b.rx >= 16 && Math.abs(b.ry / b.rx - 0.42) < 1e-8));
  check(`${tag}:insideCanvas`, bodies.every(b => b.x - b.rx >= 0 && b.x + b.rx <= canvas.width && b.y - b.ry >= 0 && b.y + b.ry <= canvas.height));
  check(`${tag}:headerClear`, bodies.every(b => !overlap({ ...b, rx: b.rx + b.width / 2, ry: b.ry + b.width / 2 }, header)));
  check(`${tag}:footerClear`, bodies.every(b => !overlap({ ...b, rx: b.rx + b.width / 2, ry: b.ry + b.width / 2 }, footer)));
  check(`${tag}:noOverflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (fixture.people.length && tag.includes('sparse')) check(`${tag}:portrait`, frame.portraits.length > 0);
  const shorts = frame.texts.filter(t => discs.some(d => Math.abs(t.x - d.x) < 1 && Math.abs(t.y - d.y - 0.5) < 1));
  // Preserve the pre-disc short-name size gate: small/deep discs use the
  // collision-routed full label instead of overprinting their close neighbors.
  const readable = discs.filter(d => d.rx >= 2.1 * 11);
  check(`${tag}:shortNames`, shorts.length === readable.length && shorts.every(t => t.color === colors.fg));
  // Full labels (12/14px) are tested against actual ellipse and circular bodies,
  // including departments with no full label, rather than against old radii.
  const labels = frame.texts.filter(t => /^(?:400 )?12px|^600 14px/.test(t.font));
  const rects = labels.map(t => ({ x1: t.x - t.width / 2, x2: t.x + t.width / 2, y1: t.y - 6, y2: t.y + 6 }));
  check(`${tag}:labelBodiesClear`, rects.every(r => bodies.every(b => !overlap(b, r))));
  check(`${tag}:labelControlsClear`, rects.every(r => [header, footer].every(p => r.x2 < p.x1 || r.x1 > p.x2 || r.y2 < p.y1 || r.y1 > p.y2)));
  check(`${tag}:leaderOnDiscEdge`, frame.leaders.every(l => discs.some(d => Math.abs(
    ((l.from.x - d.x) / (d.rx + 2)) ** 2 + ((l.from.y - d.y) / (d.ry + 2)) ** 2 - 1) < 1e-6)));
  snapshots[tag] = { ...frame, header, footer, canvas };
  await page.screenshot({ path: path.join(output, `${tag}.png`) });
  return { frame, bodies, discs, canvas };
}

async function interactions(page, fixture, tag) {
  const stage = page.getByTestId('legion-3d-stage');
  const canvas = page.getByRole('img', { name: '军团三维拓扑图', exact: true });
  const disc = () => page.evaluate(() => window.__discFrame.shapes.find(s => s.method === 'ellipse' && Math.abs(s.width - 1.4) < 0.001));
  const original = await disc();
  const box = await canvas.boundingBox();
  // Pick the actual wide edge, which lay outside the previous circular hit body.
  const edge = { x: box.x + original.x + original.rx - 1, y: box.y + original.y };
  await page.mouse.move(edge.x, edge.y);
  await frames(page);
  check(`${tag}:hoverEllipse`, await page.evaluate(() => window.__discFrame.shapes.some(s => s.method === 'ellipse' && s.width === 1 && s.rx > s.ry)));
  await page.mouse.click(edge.x, edge.y);
  await page.getByTestId('legion-3d-detail').waitFor();
  check(`${tag}:edgeSelectsDepartment`, (await page.getByTestId('legion-3d-detail').textContent()).includes(longName));
  await frames(page);
  const selected = await page.evaluate(() => window.__discFrame.shapes.find(s => s.method === 'ellipse' && Math.abs(s.width - 1.2) < 0.001));
  const selectedBody = await disc();
  check(`${tag}:selectedEllipse`, almost(selected, { ...selectedBody, rx: selectedBody.rx + 4, ry: selectedBody.ry + 4 }));
  check(`${tag}:copyFont11`, await page.getByTestId('legion-3d-copy').evaluate(el => getComputedStyle(el).fontSize === '11px'));
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await page.mouse.move(1, 1);
  await frames(page, 8);
  const reset = await disc();
  const blank = { x: box.x + reset.x, y: box.y + reset.y - Math.max(16, reset.ry + 6) - 3 };
  await page.mouse.move(blank.x, blank.y);
  await frames(page);
  check(`${tag}:blankNotHovered`, !await page.evaluate(() => window.__discFrame.shapes.some(s => s.method === 'ellipse' && s.width === 1)));
  await page.mouse.click(blank.x, blank.y);
  check(`${tag}:blankNotSelected`, await page.getByTestId('legion-3d-detail').count() === 0);
  // Exercise the third hitTest call via a double click on the disc edge. Only
  // local navigation is observed; no backend mutation or real account is used.
  await page.mouse.dblclick(box.x + reset.x + reset.rx - 1, box.y + reset.y);
  await page.waitForURL('**/org');
  check(`${tag}:edgeDoubleClick`, new URL(page.url()).pathname === '/org');
  await page.goto(`${base}/legion/3d`, { waitUntil: 'networkidle' });
  if (await page.getByTestId('legion-3d-spin').getAttribute('aria-pressed') === 'true') await page.getByTestId('legion-3d-spin').click();
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await page.mouse.move(1, 1);
  await frames(page, 8);
  const baseline = await disc();
  const h = await page.getByTestId('legion-3d-header').boundingBox();
  const drag = async () => {
    await page.mouse.move(box.x + 35, h.y + h.height + 35);
    await page.mouse.down();
    await page.mouse.move(box.x + 155, h.y + h.height + 150, { steps: 10 });
    await page.mouse.up();
    await page.mouse.move(1, 1);
    await frames(page);
  };
  await drag();
  const dragged = await disc();
  check(`${tag}:nonOriginActuallyMoved`, Math.hypot(baseline.x - dragged.x, baseline.y - dragged.y) > 5);
  await frames(page, 130);
  const settled = await disc();
  check(`${tag}:nonOriginStable130RAF`, almost(dragged, settled));
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await frames(page, 8);
  check(`${tag}:buttonRestoresPose`, almost(baseline, await disc()));
  await drag();
  await stage.focus();
  await page.keyboard.press('r');
  await frames(page, 8);
  check(`${tag}:rRestoresPose`, almost(baseline, await disc()));
  snapshots[`${tag}:rotation`] = { baseline, dragged, settled, reset: await disc() };
  await page.getByTestId('legion-3d-clean').click();
  await stage.focus();
  await page.keyboard.press('r');
  await frames(page, 8);
  await page.keyboard.press('Escape');
  await capture(page, `${tag}-clean-restored`, fixture);
  await page.getByTestId('legion-3d-search').fill('no-such-fixture');
  check(`${tag}:clearFont11`, await page.getByRole('button', { name: '清空搜索', exact: true }).last().evaluate(el => getComputedStyle(el).fontSize === '11px'));
  await page.getByRole('button', { name: '清空搜索', exact: true }).first().click();
  await page.getByTestId('legion-3d-list-toggle').click();
  check(`${tag}:listFont11`, await page.getByRole('option').first().locator('span').first().evaluate(el => getComputedStyle(el).fontSize === '11px'));
}

try {
  for (const [name, fixture] of Object.entries(fixtures)) for (const theme of ['cyber', 'light']) for (const width of [1440, 390]) {
    const tag = `${name}-${theme}-${width}`;
    const { page, context } = await createPage(fixture, theme, width);
    const { frame } = await capture(page, tag, fixture);
    if (name === 'sparse') {
      const nameLines = frame.texts.filter(t => /^(?:400 )?12px/.test(t.font) && longName.includes(t.text));
      check(`${tag}:longNameWrapped`, nameLines.length >= 2 && nameLines.map(t => t.text).join('') === longName);
      await interactions(page, fixture, tag);
    }
    if (name === 'dense') {
      await page.getByTestId('legion-3d-list-toggle').click();
      check(`${tag}:largeListFont11`, await page.getByText(/^成员超过 60/).evaluate(el => getComputedStyle(el).fontSize === '11px'));
    }
    if (name === 'hierarchy') {
      check(`${tag}:leadersPresent`, frame.leaders.length > 0);
      await page.getByTestId('legion-3d-list-toggle').click();
      await page.getByRole('option', { name: '部门 协同中心', exact: true }).click();
      if (await page.getByTestId('legion-3d-list-toggle').getAttribute('aria-expanded') === 'true') {
        await page.getByTestId('legion-3d-list-toggle').click();
      }
      await page.mouse.move(1, 1);
      await frames(page, 130);
      const active = await page.evaluate(() => window.__discFrame);
      const discs = active.shapes.filter(s => s.method === 'ellipse' && Math.abs(s.width - 1.4) < 0.001);
      const shorts = active.texts.filter(t => discs.some(d => Math.abs(t.x - d.x) < 1 && Math.abs(t.y - d.y - 0.5) < 1));
      check(`${tag}:selectedParentShortsClear`, shorts.every((a, i) => shorts.slice(i + 1).every(b =>
        Math.abs(a.x - b.x) > (a.width + b.width) / 2 || Math.abs(a.y - b.y) > 13)));
      if (width === 1440) check(`${tag}:selectedParentShowsShortName`, shorts.length > 0);
      await page.screenshot({ path: path.join(output, `${tag}-parent-selected.png`) });
    }
    await context.close();
  }
} catch (error) {
  errors.push(error.stack || String(error));
} finally {
  await browser.close();
  check('noPageErrors', errors.length === 0);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ...metadata, checks, snapshots, errors }, null, 2));
  const failed = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
  console.log(JSON.stringify({ ...metadata, passed: Object.keys(checks).length - failed.length, failed, errors }, null, 2));
  assert.equal(failed.length, 0, failed.join(', '));
}
