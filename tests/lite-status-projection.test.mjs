// 契约：/api/hub/status?lite=1 的投影必须保留「页面实际读取」的字段。
//
// 起因（2026-11-09）：.418 给节点详情副行加了「版本」chip，但 .409 的 lite 投影
// 早已把 version 去掉（注释写着「首页从不读取」）。typecheck 通过、构建成功、
// 20 套验收全绿 —— 生产上那一段却渲染成空字符串。只有 DOM 复核才抓到。
//
// 这里把「UI 要读哪些字段」写成清单：谁把字段从 KEEP 里删掉，这里立刻红。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 注意：`import.meta.dir` 只有 bun 有，node ESM 里是 undefined（这里被 node 跑时会崩）。
// 用 fileURLToPath + dirname 兼容两边。
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const route = readFileSync(join(root, 'app/api/hub/status/route.ts'), 'utf8');

// 页面读取的字段（有新增读取时，这里同步加；两份清单必须一致）
const REQUIRED = [
  'alias', 'status', 'agent', 'server', 'task', 'progress', 'updated_at',
  'node_id', 'session_id', 'last_seen_at', 'network_id', 'model', 'runtime',
  'lifecycle_state', 'channels', 'version',
];

const m = route.match(/const KEEP = \[([\s\S]*?)\] as const/);
if (!m) {
  console.error('lite-status-projection: 找不到 KEEP 列表');
  process.exit(1);
}
const keep = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
const missing = REQUIRED.filter(k => !keep.includes(k));
if (missing.length) {
  console.error(`lite-status-projection: KEEP 缺少页面要读的字段 → ${missing.join(', ')}`);
  process.exit(1);
}

// 反向检查：页面里真的会读 version（避免「字段留着但没人用」的僵尸条目）
const chatPane = readFileSync(join(root, 'app/components/ChatPane.tsx'), 'utf8');
if (!chatPane.includes('session.version')) {
  console.error('lite-status-projection: ChatPane 不再读取 session.version，请同步调整 KEEP 与清单');
  process.exit(1);
}

console.log(`lite-status-projection: PASS（KEEP ${keep.length} 项，覆盖页面读取的 ${REQUIRED.length} 项）`);
