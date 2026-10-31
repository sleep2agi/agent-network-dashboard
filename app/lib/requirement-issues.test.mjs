import { describe, expect, test } from 'bun:test';
import { addIssue, issueLabel, issuesFromHub, issuesWire, MAX_REQUIREMENT_ISSUES, parseIssue } from './requirement-issues';

describe('关联 issue 解析', () => {
  test('接受完整 URL 与简写，拒绝其它形态', () => {
    expect(parseIssue('https://github.com/sleep2agi/agent-network-dashboard/issues/137')).toEqual({
      repo: 'sleep2agi/agent-network-dashboard', number: 137, title: '',
    });
    expect(parseIssue('sleep2agi/agent-network-dashboard#137')).toEqual({
      repo: 'sleep2agi/agent-network-dashboard', number: 137, title: '',
    });
    expect(parseIssue('https://github.com/a/b/pull/1')).toBeNull();
    expect(parseIssue('https://gitlab.com/a/b/issues/1')).toBeNull();
    expect(parseIssue('a/b#0')).toBeNull();
    expect(parseIssue('随便写的')).toBeNull();
  });

  test('Hub 读不懂的数据返回 undefined，不要覆盖成空', () => {
    expect(issuesFromHub([{ url: 'https://github.com/a/b/issues/1', title: 't' }])).toEqual([
      { repo: 'a/b', number: 1, title: 't' },
    ]);
    expect(issuesFromHub([{ url: 'https://example.com/x' }])).toBeUndefined();
    expect(issuesFromHub([{ url: 'https://github.com/a/b/issues/1' }, { url: 'https://github.com/a/b/issues/1' }])).toHaveLength(1);
    expect(issuesFromHub(new Array(MAX_REQUIREMENT_ISSUES + 1).fill({ url: 'https://github.com/a/b/issues/1' }))).toBeUndefined();
  });

  test('写回只发 Hub 认识的 url/title', () => {
    expect(issuesWire([{ repo: 'a/b', number: 2, title: 'x' }])).toEqual([
      { url: 'https://github.com/a/b/issues/2', title: 'x' },
    ]);
  });

  test('追加会去重并守住上限', () => {
    const first = addIssue([], 'a/b#1');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dup = addIssue(first.issues, 'https://github.com/a/b/issues/1');
    expect(dup.ok).toBe(false);
    const full = Array.from({ length: MAX_REQUIREMENT_ISSUES }, (_, i) => ({ repo: 'a/b', number: i + 1, title: '' }));
    expect(addIssue(full, 'a/b#99').ok).toBe(false);
    const bad = addIssue([], 'nope');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('github.com');
  });

  test('标签用 repo#number', () => {
    expect(issueLabel({ repo: 'a/b', number: 3, title: '' })).toBe('a/b#3');
  });
});
