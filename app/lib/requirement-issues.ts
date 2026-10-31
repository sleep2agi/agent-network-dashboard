/**
 * 关联 issue 的解析与校验 —— 与客户端 APP 的 requirement-issues.ts 同一套规则。
 *
 * 为什么单独一个模块：Hub 只接受「GitHub issue URL」，上限 8 条，且要求不改变
 * 顺序之外的东西；如果前端随便拼字符串，写回去会把 Hub 上原本合法的列表清空。
 * 这里只做两件事：把用户输入（URL 或 owner/repo#123 简写）解析成规范形态，
 * 以及把解析结果按 Hub 的线格式写回。
 */

export interface RequirementIssue {
  repo: string;
  number: number;
  title: string;
}

export const MAX_REQUIREMENT_ISSUES = 8;

const ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/;
const ISSUE_SHORT = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/;

export function parseIssue(input: string, shorthand = true): RequirementIssue | null {
  const text = input.trim();
  const match = ISSUE_URL.exec(text) ?? (shorthand ? ISSUE_SHORT.exec(text) : null);
  if (!match) return null;
  const number = Number(match[3]);
  if (!Number.isInteger(number) || number < 1 || number > 10_000_000) return null;
  return { repo: `${match[1]}/${match[2]}`, number, title: '' };
}

export const issueLabel = (issue: RequirementIssue) => `${issue.repo}#${issue.number}`;
export const issueUrl = (issue: RequirementIssue) => `https://github.com/${issue.repo}/issues/${issue.number}`;

/** Hub → UI。读不懂就返回 undefined：宁可显示「不支持」也不覆盖原始数据。 */
export function issuesFromHub(raw: unknown): RequirementIssue[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_REQUIREMENT_ISSUES) return undefined;
  const out: RequirementIssue[] = [];
  for (const row of raw) {
    const source = typeof row === 'string'
      ? row
      : row && typeof row === 'object'
        ? (typeof (row as { url?: unknown }).url === 'string'
          ? (row as { url: string }).url
          : `https://github.com/${(row as { repo?: string }).repo}/issues/${(row as { number?: number }).number}`)
        : '';
    const parsed = parseIssue(String(source), false);
    if (!parsed) return undefined;
    const title = row && typeof row === 'object' ? (row as { title?: unknown }).title : '';
    if (typeof title === 'string') parsed.title = title;
    if (!out.some(item => issueLabel(item) === issueLabel(parsed))) out.push(parsed);
  }
  return out.length <= MAX_REQUIREMENT_ISSUES ? out : undefined;
}

/** UI → Hub：只写 Hub 认识的字段。 */
export function issuesWire(issues: readonly RequirementIssue[]): Array<{ url: string; title: string }> {
  return issues.map(issue => ({ url: issueUrl(issue), title: issue.title }));
}

/** 追加一条（去重、限长），失败时给出可读原因而不是静默吞掉。 */
export function addIssue(
  issues: readonly RequirementIssue[],
  input: string,
): { ok: true; issues: RequirementIssue[] } | { ok: false; error: string } {
  const parsed = parseIssue(input);
  if (!parsed) return { ok: false, error: '请输入 https://github.com/owner/repo/issues/123 或 owner/repo#123' };
  if (issues.some(item => issueLabel(item) === issueLabel(parsed))) {
    return { ok: false, error: `${issueLabel(parsed)} 已经在列表里` };
  }
  if (issues.length >= MAX_REQUIREMENT_ISSUES) {
    return { ok: false, error: `Hub 最多关联 ${MAX_REQUIREMENT_ISSUES} 个 issue，先移除一个再加` };
  }
  return { ok: true, issues: [...issues, parsed] };
}
