// #1831 —— 评论 Markdown 的**真实渲染**验证（不是读源码的契约）。
//
// 用 react-dom/server 把 CommentMarkdown 渲成 HTML，直接断言 admin 截图里那三样
// （`## 归因更正`、`**错误**`、反引号 `agent_owner`）产出的是 <h2>/<strong>/<code>，
// 而不是原字符；顺带钉住列表、表格、外链与「标签当文字」。
//
// 需要 JSX/TS，所以按仓里 tests/test-chat-ha/*.test.mts 的惯例走 bun。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CommentMarkdown from '../app/components/CommentMarkdown.tsx';

const render = (text: string) => renderToStaticMarkup(createElement(CommentMarkdown, { text }));

test('admin 截图那段评论：标题 / 粗体 / 行内 code 不再是原字符', () => {
  const html = render('## 归因更正\n\n我初版确认**错误**：`agent_owner` 才是权威。');
  assert.match(html, /<h2[^>]*>归因更正<\/h2>/, '## 标题应渲染成 h2');
  assert.match(html, /<strong[^>]*>错误<\/strong>/, '**错误** 应渲染成 strong');
  assert.match(html, /<code[^>]*>agent_owner<\/code>/, '反引号应渲染成 code');
  assert.doesNotMatch(html, /## 归因更正/, '不应残留原始 ##');
  assert.doesNotMatch(html, /\*\*错误\*\*/, '不应残留原始 **');
});

test('列表渲染成 ul/li，而不是带 - 的文本行', () => {
  const html = render('- 第一条\n- 第二条');
  assert.match(html, /<ul>/);
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.doesNotMatch(html, />\s*-\s*第一条/);
});

test('围栏代码保留原文，里面的星号不会被当成强调', () => {
  const html = render('```ts\nconst x = a ** b;\n```');
  assert.match(html, /<pre/);
  assert.match(html, /const x = a \*\* b;/);
  assert.doesNotMatch(html, /<strong>/);
});

test('GFM 表格渲染成 table', () => {
  const html = render('| 项 | 值 |\n| --- | --- |\n| a | 1 |');
  assert.match(html, /<table/);
  assert.match(html, /<th[^>]*>项<\/th>/);
  assert.match(html, /<td[^>]*>1<\/td>/);
});

test('外链新窗口打开并带 noopener', () => {
  const html = render('[文档](https://anet.sh/docs)');
  assert.match(html, /<a[^>]*href="https:\/\/anet\.sh\/docs"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('评论里的 HTML 标签只是文字（没有 rehype-raw）', () => {
  const html = render('<script>alert(1)</script> 以及 <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<img[^>]*onerror/i);
  assert.match(html, /&lt;script&gt;/);
});

test('纯文本评论仍然是逐行原文（不吞换行、不改字）', () => {
  const html = render('第一行\n第二行');
  assert.match(html, /第一行\n第二行/);
});

test('空评论不渲染容器', () => {
  assert.equal(render(''), '');
});
