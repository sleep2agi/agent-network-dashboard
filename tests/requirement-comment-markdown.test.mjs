// #1831 —— 需求详情页的评论正文必须按 Markdown 渲染（admin 2026-10-19 截图：
// `## 归因更正` / `**错误**` / 反引号原样露出）。
//
// 客户端那半边在 agent-network-app #961（共用 CommentBody + MarkdownMessage）。
// 这里钉住 Web 侧的接线，避免「改了客户端、网页还是纯文本」这种半修。
import { readFileSync } from 'node:fs';

let passed = 0;
function check(label, condition) {
  if (!condition) { console.error(`FAIL: ${label}`); process.exit(1); }
  passed++; console.log(`PASS: ${label}`);
}

const page = readFileSync('app/requirements/[id]/page.tsx', 'utf8');
const body = readFileSync('app/components/CommentMarkdown.tsx', 'utf8');

// 时间线：comment 走 Markdown，其余（字段变更）保持原样的一行文本。
check('activity item renders comments through CommentMarkdown',
  /d\.label === 'comment'\s*\n?\s*\? <CommentMarkdown text=\{d\.body\} \/>/.test(page));
check('field-change bodies keep the plain paragraph',
  page.includes('<p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-300">{d.body}</p>'));
check('page imports the component',
  page.includes("import CommentMarkdown from '../../components/CommentMarkdown';"));

// 复用本仓已有的渲染器，而不是自己拼 HTML。
check('component uses react-markdown + remark-gfm',
  body.includes("from 'react-markdown'") && body.includes("from 'remark-gfm'")
  && body.includes('<ReactMarkdown remarkPlugins={[remarkGfm]}'));
check('no raw HTML injection surface', !body.includes('dangerouslySetInnerHTML') && !/from ['"]rehype-raw['"]/.test(body));
check('external links open in a new tab with noopener',
  body.includes("target=\"_blank\"") && body.includes('rel="noopener noreferrer"'));
// ⚠️ 本仓没装 @tailwindcss/typography：`prose` 是空类，而 Tailwind preflight 会把
// 标题的 font-size/weight 重置成继承、把列表的 list-style 清掉。评论渲染必须逐个元素给类。
check('does not rely on the (absent) typography plugin',
  !/className="[^"]*\bprose\b/.test(body));
check('headings/lists/code are styled element by element',
  body.includes('h2:') && body.includes('list-disc') && body.includes('list-decimal')
  && body.includes('font-mono') && body.includes('text-[var(--fg)]'));

// 描述区仍是同一套渲染，别在改评论时把描述弄回纯文本。
check('description still renders markdown', page.includes('<ReactMarkdown remarkPlugins={[remarkGfm]}>{req.description}</ReactMarkdown>'));

console.log(`\nrequirement-comment-markdown: ${passed}/${passed} passed`);
