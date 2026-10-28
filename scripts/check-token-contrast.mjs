#!/usr/bin/env node
/**
 * Token 级对比度门槛 —— 不进浏览器，跑在 gates 里。
 *
 * 为什么不用浏览器版（scripts/check-contrast.mjs）：那版要起 app + 装
 * Playwright 浏览器，CI 里 3–5 分钟起步；而「文字色 vs 背景色」这类问题
 * 90% 来自 token 本身选错，直接在 globals.css 的 token 上算比值最便宜。
 *
 * 覆盖：每个主题块的 --fg / --fg-muted / --fg-dim / 语义色，对三种底色
 * （bg / bg-secondary / bg-elevated）算 WCAG 对比度，阈值 4.5:1。
 *
 * --accent 只做填充/描边（深色下当文字只有 4.27，这是有意的取舍），所以
 * 它只警告不拦门；当文字一律用 --accent-text（深色 #a78bfa 6.64:1，
 * 浅色跟随 accent），那一项按 4.5 拦门。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

const TEXT_TOKENS = ['--fg', '--fg-muted', '--fg-dim', '--success', '--warning', '--danger', '--info'];
const BG_TOKENS = ['--bg', '--bg-secondary', '--bg-elevated'];
const TEXT_EXTRA = ['--accent-text']; // accent 本身只做填充，文字走 accent-text
const WARN_TOKENS = ['--accent'];
const MIN = 4.5;

/** 取出每个主题选择器块里的 token 值。只看「顶层」块，够用且不引入 CSS 解析器。 */
function parseThemes(src) {
  const themes = [];
  const re = /(:root,\s*\[data-theme="[a-z]+"\]|\[data-theme="[a-z]+"\])\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(src))) {
    const selector = m[1].trim();
    const body = m[2];
    const tokens = {};
    for (const line of body.split('\n')) {
      const t = line.match(/^\s*(--[a-z-]+):\s*([^;]+);/);
      if (t) tokens[t[1]] = t[2].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    }
    if (tokens['--bg'] && tokens['--fg']) {
      themes.push({ selector, tokens });
    }
  }
  return themes;
}

const hex = (v) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};
const lum = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const themes = parseThemes(css);
if (themes.length < 2) {
  console.error('token-contrast: 只解析到 ' + themes.length + ' 个主题块 —— 解析器需要跟着 globals.css 的结构更新');
  process.exit(1);
}

let failures = 0;
let warnings = 0;
for (const { selector, tokens } of themes) {
  for (const bgName of BG_TOKENS) {
    const bg = hex(tokens[bgName] || '');
    if (!bg) continue;
    for (const fgName of TEXT_TOKENS) {
      const fg = hex(tokens[fgName] || '');
      if (!fg) continue;
      const r = ratio(fg, bg);
      if (r < MIN) {
        failures++;
        console.error(`token-contrast: ${selector} ${fgName} on ${bgName} = ${r.toFixed(2)}:1 (< ${MIN})`);
      }
    }
    for (const fgName of TEXT_EXTRA) {
      const raw = tokens[fgName] || '';
      // var(--accent) 这类引用要解析回本主题的 accent
      const ref = raw.match(/var\((--[a-z-]+)\)/);
      const fg = hex(ref ? (tokens[ref[1]] || '') : raw);
      if (!fg) continue;
      const r = ratio(fg, bg);
      if (r < MIN) {
        failures++;
        console.error(`token-contrast: ${selector} ${fgName} on ${bgName} = ${r.toFixed(2)}:1 (< ${MIN})`);
      }
    }
    for (const fgName of WARN_TOKENS) {
      const fg = hex(tokens[fgName] || '');
      if (!fg) continue;
      const r = ratio(fg, bg);
      if (r < MIN) {
        warnings++;
        console.warn(`token-contrast(warn): ${selector} ${fgName} on ${bgName} = ${r.toFixed(2)}:1 —— 品牌色只做填充/描边；当文字请用 --accent-text`);
      }
    }
  }
}

if (failures > 0) {
  console.error(`token-contrast: ${failures} 处不达标（${warnings} 处品牌色警告）`);
  process.exit(1);
}
console.log(`token-contrast: ✓ ${themes.length} 个主题 × ${BG_TOKENS.length} 种底色，文字色全部 ≥ ${MIN}:1${warnings ? `（${warnings} 处 accent 警告）` : ''}`);
