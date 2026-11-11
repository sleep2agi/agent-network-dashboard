// 定时任务页的读取失败契约（2026-11-11）
//
// 事故形态：会话没有权限读 Hub 计划表时，接口返回 user_token_required（403），
// 页面却同时做了两件错事：
//   ① 把原始错误码铺在界面上（用户不知道原因与下一步）
//   ② 列表渲染成「还没有 Hub 定时任务」——把"没权限"说成"本来就没有计划"
//
// 这条测试锁住：
//   · 读取失败必须走 loadError 分支（与操作失败 error 分开）
//   · 失败分支必须给出可读原因（describeLoadError）与原始错误
//   · 「还没有…」空态必须出现在失败分支**之后**（即失败时不渲染空态）
//
// 断言的是语义顺序，不是具体写法：谁把空态提到失败判断之前，这条就红。

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('app/scheduled-tasks/page.tsx', root), 'utf8');

// 1) 错误码翻译器存在，且覆盖权限类码
assert.match(src, /function describeLoadError/, '必须有 describeLoadError（把程序错误码翻成人话）');
assert.match(src, /user_token_required/, 'describeLoadError 必须覆盖 user_token_required');
assert.match(src, /admin/, '权限类错误必须提示需要 admin / 用户登录');

// 2) 读取失败与会话内操作失败是两个状态
assert.match(src, /const \[loadError, setLoadError\]/, '读取失败必须有独立状态 loadError');
assert.match(src, /setLoadError\(/, 'load() 的失败路径必须写 loadError');
assert.match(
  src,
  /catch \(e\) \{\s*setLoadError\(/,
  'load() 的 catch 必须写 loadError（而不是复用操作错误的 setError）',
);

// 3) 渲染顺序：loading → loadError → 空态
//    注意：文档注释里也会出现这两句文案，所以必须锚定 **JSX 形态** 而不是裸文本
//    （第一版就是被自己的注释骗了：注释在文件开头，索引永远小于 JSX ⇒ 断言必红）
const iLoading = src.indexOf('加载中…</div>');
const iLoadError = src.indexOf(': loadError ? (');
const iEmpty = src.indexOf('>还没有 Hub 定时任务</div>');
assert.ok(iLoading > 0 && iLoadError > 0 && iEmpty > 0, '三处渲染必须都存在');
assert.ok(iLoading < iLoadError, 'loadError 分支必须在 loading 之后');
assert.ok(
  iLoadError < iEmpty,
  '「还没有…」空态必须出现在 loadError 分支之后，否则读取失败会显示成空列表',
);

// 4) 失败面板必须可被探针定位，并带原始错误与重试
assert.match(src, /data-testid="schedules-load-error"/, '失败面板必须有 data-testid 便于探针断言');
assert.match(src, /原始错误：/, '失败面板必须原样透出原始错误（不吞信息）');
assert.match(src, /onClick=\{\(\) => void load\(\)\}/, '失败面板必须提供重试');

// 5) 读取失败时不能给出「新建计划」（点了必然失败）
assert.match(
  src,
  /\{!loadError && \(\s*<button type="button" onClick=\{openCreate\}/,
  '读取失败时必须隐藏「新建计划」按钮',
);

console.log('schedules load-error contract: PASS（失败不再伪装成空列表）');
