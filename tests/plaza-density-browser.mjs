// Loopback-only synthetic density acceptance. All API requests are intercepted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = process.env.BASE_URL || 'http://127.0.0.1:3175';
const output = process.env.OUTPUT_DIR;
const widths = (process.env.WIDTHS || '1920,1440,390').split(',').map(Number);
assert(widths.every(w => [1920, 1440, 390].includes(w)));
assert.equal(new URL(base).hostname, '127.0.0.1');
assert(output); await mkdir(output, { recursive: true });
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
const build = await fetch(`${base}/api/health`).then(r => r.json());
assert.equal(build.commit, process.env.EXPECTED_COMMIT || sourceCommit);
const result = { sourceCommit, sourceDirty, build, fixture: true, base,
  probeSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), checks: {}, views: [], edgeCases: [], errors: [], exit: 1 };
const check = (name, ok) => { result.checks[name] = !!ok; assert(ok, name); };
const browser = await chromium.launch({ headless: true });
try {
  for (const width of widths) for (const theme of ['cyber', 'light']) {
    const tag = `${width}-${theme}`;
    let count = 18;
    let unavailableDepartments = false;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1080 }, reducedMotion: 'no-preference' });
    await context.addCookies([{ name: 'anet_dashboard_session', value: 'density-fixture-only', url: base }]);
    await context.addInitScript(theme => {
      localStorage.setItem('anet-theme', theme); sessionStorage.setItem('anet_network_id', 'fixture-A');
      sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: { username: 'fixture', role: 'owner' }, token: 'fixture-only',
        networks: [{ network_id: 'fixture-A', network_name: 'Fixture' }], currentNetwork: 'fixture-A' }));
    }, theme);
    await context.route('**/api/**', async route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) { result.errors.push('unexpected mutation'); return route.abort(); }
      const departments = Array.from({ length: count }, (_, i) => ({ id: `dense-${i}`,
        name: `${['通信研发', '产品设计', '模型研究', '客户端', '平台架构', '质量保障'][i % 6]} ${i + 1}`,
        parent_id: i > 11 ? `dense-${i - 12}` : null, sort: i }));
      const agents = departments.flatMap((d, i) => Array.from({ length: 6 }, (_, j) => ({ node_id: `node-${i}-${j}`,
        alias: `${d.name}-节点${j + 1}`, department_id: d.id })));
      const nodes = agents.map(a => ({ ...a, network_id: 'fixture-A', model: 'deepseek/deepseek-flash', runtime: 'opencode-sdk' }));
      const sessions = nodes.map((a, i) => ({ ...a, status: ['working', 'idle', 'blocked'][i % 3], agent: a.runtime,
        session_id: `session-${i}`, task: '', server: 'fixture' }));
      const path = new URL(route.request().url()).pathname;
      const json = path === '/api/hub/people' ? { ok: true, agent_department_supported: true, total: 1,
        people: [{ user_id: 'u1', username: 'fixture', display_name: '隔离验收', role: 'owner',
          department: { id: departments[0].id, name: departments[0].name }, agents }], agents_without_owner: [], has_more: false }
        : path === '/api/hub/departments' ? { ok: true, departments: unavailableDepartments ? departments.slice(0, 1) : departments, members: [] }
          : path === '/api/hub/nodes' ? { ok: true, nodes }
            : path === '/api/hub/status' ? { ok: true, sessions }
              : path === '/api/hub/networks' ? { ok: true, networks: [{ network_id: 'fixture-A', network_name: 'Fixture' }] }
                : { ok: true, messages: [], avatars: {}, nodes: [], providers: [], requirements: [], sse_sessions: {} };
      await route.fulfill({ json });
    });
    const page = await context.newPage(); page.on('pageerror', e => result.errors.push(e.message));
    const svg = page.getByTestId('plaza-perspective-svg');
    const frames = n => page.evaluate(n => new Promise(resolve => { let i = 0;
      const tick = () => ++i >= n ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick);
    }), n);
    const inspect = () => svg.evaluate(svg => {
      const bounds = svg.getBoundingClientRect();
      const cards = [...svg.querySelectorAll('[data-testid="plaza-perspective-select"]')].map(button => ({
        id: button.closest('[data-department-id]').dataset.departmentId, rect: button.getBoundingClientRect().toJSON(),
        active: button.getAttribute('aria-pressed') === 'true', names: button.querySelectorAll('[data-testid="plaza-perspective-namecard"]').length,
      }));
      const core = [...svg.querySelectorAll('[data-testid="plaza-perspective-core"] image, [data-testid="plaza-perspective-core"] text')]
        .filter(e => getComputedStyle(e).display !== 'none').map(e => e.getBoundingClientRect().toJSON());
      const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return { cards, overlaps: cards.flatMap((a, i) => cards.slice(i + 1).filter(b => overlap(a.rect, b.rect)).map(b => [a.id, b.id])),
        clipped: cards.filter(c => c.rect.left < bounds.left || c.rect.right > bounds.right || c.rect.top < bounds.top || c.rect.bottom > bounds.bottom).map(c => c.id),
        coreHidden: cards.some(c => core.some(r => overlap(c.rect, r))) };
    });
    const camera = () => svg.evaluate(e => [e.dataset.yaw, e.dataset.pitch, e.dataset.zoom, e.dataset.panX, e.dataset.panY]);
    const validate = async name => {
      const state = await inspect();
      check(`${tag}:${name}:noOverlap`, state.overlaps.length === 0);
      check(`${tag}:${name}:contained`, state.clipped.length === 0);
      check(`${tag}:${name}:brandVisible`, !state.coreHidden);
      check(`${tag}:${name}:selectedSixNames`, state.cards.find(c => c.active)?.names === 6);
      return state;
    };
    await page.goto(`${base}/legion/plaza`); await svg.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-node-id="node-0-0"][data-session-status="working"]'));
    await frames(5);
    const initial = await inspect();
    await page.screenshot({ path: `${output}/${tag}.png`, fullPage: true });
    check(`${tag}:allPlatforms`, await page.getByTestId('plaza-perspective-department').count() === 18);
    if (width > 390) check(`${tag}:allOverviewCards`, initial.cards.length === 18);
    await validate('initial');
    const beforeSelect = await camera();
    await page.getByTestId('plaza-department-select').selectOption('dept:dense-17');
    check(`${tag}:selectionKeepsCamera`, JSON.stringify(await camera()) === JSON.stringify(beforeSelect));
    await validate('selected');
    await page.getByRole('button', { name: '定位所选', exact: true }).click(); await frames(3);
    const focused = await validate('focused');
    await page.screenshot({ path: `${output}/${tag}-focused.png`, fullPage: true });
    await svg.focus(); await page.keyboard.press('ArrowLeft'); await frames(3);
    const rotated = await camera(), placed = await inspect();
    await frames(130);
    check(`${tag}:stableCamera130RAF`, JSON.stringify(await camera()) === JSON.stringify(rotated));
    check(`${tag}:stableCards130RAF`, JSON.stringify(await inspect()) === JSON.stringify(placed));
    await validate('rotated');
    await page.keyboard.press('r');
    check(`${tag}:resetCamera`, JSON.stringify(await camera()) === JSON.stringify(beforeSelect));
    await page.getByTestId('plaza-mode-2d').click(); await page.getByTestId('legion-plaza-svg').waitFor();
    await page.getByTestId('plaza-mode-3d').click(); await svg.waitFor();
    await validate('return3d');
    check(`${tag}:noPageOverflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    result.views.push({ width, theme, initial, focused, rotated: placed });
    if (width === 390) {
      await svg.focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowUp');
      await frames(3);
      check(`${tag}:mobilePanApplied`, (await camera())[4] === '-120');
      for (const selected of ['dept:dense-17', 'dept:dense-0']) {
        await page.getByTestId('plaza-department-select').selectOption(selected);
        const state = await inspect();
        check(`${tag}:mobilePan:${selected}:selectedVisible`, state.cards.some(c => c.id === selected && c.active && c.names > 0));
        check(`${tag}:mobilePan:${selected}:readable`, !state.overlaps.length && !state.clipped.length && !state.coreHidden);
        check(`${tag}:mobilePan:${selected}:completeRosterAccessible`, await page.getByTestId('plaza-agent').count() === 6);
        result.edgeCases.push({ tag, selected, state });
      }
      await page.screenshot({ path: `${output}/${tag}-panned.png`, fullPage: true });
    } else {
      unavailableDepartments = true; await page.reload(); await svg.waitFor(); await frames(5);
      const state = await inspect();
      result.edgeCases.push({ tag, unavailableDepartments: true, state });
      await page.screenshot({ path: `${output}/${tag}-unavailable-departments.png`, fullPage: true });
      check(`${tag}:unknownDepartments:allPlatforms`, await page.getByTestId('plaza-perspective-department').count() === 18);
      await validate('unknownDepartments');
    }
    if (width === 1920 && theme === 'cyber') {
      count = 120; unavailableDepartments = false; await page.reload(); await svg.waitFor(); await frames(3);
      check('oversize:allPlatforms', await page.getByTestId('plaza-perspective-department').count() === 120);
      check('oversize:overflowExplained', await page.getByTestId('plaza-label-overflow').isVisible());
      await page.getByTestId('plaza-department-select').selectOption('dept:dense-119');
      await validate('oversizeSelected');
      check('oversize:allChoices', await page.getByTestId('plaza-department-select').locator('option').count() === 120);
    }
    await context.close();
  }
  check('allContextsCompleted', result.views.length === widths.length * 2);
  check('noPageErrorsOrWrites', result.errors.length === 0);
  result.exit = 0;
} finally {
  await browser.close();
  result.total = Object.keys(result.checks).length; result.passed = Object.values(result.checks).filter(Boolean).length;
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ sourceCommit, build, total: result.total, passed: result.passed, errors: result.errors }));
}
