#!/usr/bin/env node
/**
 * 发版后回查（可放进发布流程，退出码 0/1）：
 *
 *   node scripts/verify-prod.mjs --base http://127.0.0.1:3001 --expect 0.6.3-preview.63
 *   node scripts/verify-prod.mjs --base http://y.vansin.top:3100   # 公网只看版本与页面壳
 *   node scripts/verify-prod.mjs --base http://127.0.0.1:3001 --browser  # 再加浏览器 smoke
 *
 * 为什么单独一个脚本：每次发版都要「版本 / 关键路径 / 未登录语义 / 控制台无报错」
 * 四件事各回读一次，手敲 curl 容易漏，也容易把旧结果当新结果。
 *
 * 只做只读检查：不登录、不写数据、不改配置。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = (arg('base', 'http://127.0.0.1:3001')).replace(/\/$/, '');
const EXPECT = arg('expect', null);
const USE_BROWSER = args.includes('--browser');

const results = [];
const ok = (name, detail) => results.push({ name, ok: true, detail });
const bad = (name, detail) => results.push({ name, ok: false, detail });

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgVersion = (() => {
  try { return JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version; } catch { return null; }
})();
const buildCommit = (() => {
  try { return readFileSync(join(REPO, '.next/BUILD_COMMIT'), 'utf8').trim(); } catch { return null; }
})();

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  const text = await res.text().catch(() => '');
  return { status: res.status, text, location: res.headers.get('location') };
};

// 1) 登录页 + 版本
try {
  const { status, text } = await get('/login');
  const found = (text.match(/0\.6\.\d+-preview\.\d+/) || [])[0] || null;
  const want = EXPECT || pkgVersion;
  status === 200 && found && (!want || found === want)
    ? ok('登录页 200 + 版本匹配', { found, want })
    : bad('登录页 200 + 版本匹配', { status, found, want });
} catch (e) {
  bad('登录页 200 + 版本匹配', String(e).slice(0, 120));
}

// 1b) 健康检查：/api/health 给出运行中的版本与构建提交（运维/监控用）
try {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json().catch(() => ({}));
  const want = EXPECT || pkgVersion;
  const good = res.status === 200 && body.ok === true && (!want || body.version === want);
  good
    ? ok('/api/health 版本与构建提交', { version: body.version, commit: (body.commit || '').slice(0, 8), uptimeSec: body.uptimeSec })
    : bad('/api/health 版本与构建提交', { status: res.status, body });
} catch (e) {
  bad('/api/health 版本与构建提交', String(e).slice(0, 120));
}

// 2) 关键路径：/legion、/legion/3d、/org（未登录也应返回页面，不是 500）
for (const [path, marker] of [['/legion', null], ['/legion/3d', 'legion-3d-stage'], ['/org', null], ['/tasks', null]]) {
  try {
    const { status, text } = await get(path);
    const goodStatus = status === 200 || status === 307;
    const goodMarker = !marker || text.includes(marker);
    goodStatus && goodMarker
      ? ok(`关键路径 ${path}`, { status, marker: !!marker })
      : bad(`关键路径 ${path}`, { status, markerFound: marker ? text.includes(marker) : null });
  } catch (e) {
    bad(`关键路径 ${path}`, String(e).slice(0, 120));
  }
}

// 3) 未登录的数据接口必须是 401（不能 200 泄露、也不能 5xx）
try {
  const res = await fetch(`${BASE}/api/hub/status`);
  const body = await res.text();
  res.status === 401 && body.includes('login required')
    ? ok('未登录 API 语义', { status: res.status })
    : bad('未登录 API 语义', { status: res.status, body: body.slice(0, 80) });
} catch (e) {
  bad('未登录 API 语义', String(e).slice(0, 120));
}

// 4) 静态资源真的能拿到（发版最常见的「HTML 在、chunk 404」）
try {
  const { text } = await get('/login');
  const css = (text.match(/href="([^"]+\.css)"/) || [])[1];
  const js = (text.match(/src="([^"]+\.js)"/) || [])[1];
  const assets = [];
  for (const a of [css, js].filter(Boolean)) {
    const r = await fetch(`${BASE}${a}`);
    assets.push({ a: a.replace(/^\/_next/, '/_next'), s: r.status });
  }
  assets.length > 0 && assets.every(x => x.s === 200)
    ? ok('静态资源 200', assets)
    : bad('静态资源 200', assets);
} catch (e) {
  bad('静态资源 200', String(e).slice(0, 120));
}

// 5) 可选：浏览器 smoke（未登录只验控制台无报错 + 登录表单可用）
if (USE_BROWSER) {
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch();
    const page = await b.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 25000 });
    const hasForm = await page.locator('input[type="password"]').count();
    await page.goto(`${BASE}/legion/3d`, { waitUntil: 'networkidle', timeout: 25000 });
    const landed = new URL(page.url()).pathname;
    await b.close();
    errs.length === 0 && hasForm > 0 && landed === '/login'
      ? ok('浏览器 smoke（未登录）', { hasForm, landed })
      : bad('浏览器 smoke（未登录）', { hasForm, landed, errs });
  } catch (e) {
    bad('浏览器 smoke（未登录）', String(e).slice(0, 140));
  }
}

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name} ${JSON.stringify(r.detail)}`);
console.log(`\nversion=${pkgVersion} buildCommit=${buildCommit ?? '<missing>'} base=${BASE}`);
console.log(results.every(r => r.ok) ? `verify-prod: ✓ ${results.length} 项通过` : `verify-prod: ${results.filter(r => !r.ok).length} 项失败 / ${results.length}`);
process.exit(results.every(r => r.ok) ? 0 : 1);
