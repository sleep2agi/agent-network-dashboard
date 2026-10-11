import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compareRequirements,
  isRequirementOverdue,
  matchesRequirementQuery,
  normalizeRequirement,
  periodFromIso,
  personLabel,
  readStats,
  requirementDetailPath,
  scheduleBucket,
  shortIdLabel,
} from './requirement-links.mjs';

assert.equal(shortIdLabel(918), '#918');
assert.equal(shortIdLabel(0), null);
assert.equal(shortIdLabel(1.5), null);
assert.equal(shortIdLabel('918'), null);

assert.equal(requirementDetailPath('req_abc-123'), '/board/req_abc-123');
assert.equal(requirementDetailPath('  req_abc-123  '), '/board/req_abc-123');
assert.equal(requirementDetailPath(''), null);
assert.equal(requirementDetailPath('../etc'), null);
assert.equal(requirementDetailPath('req/nested'), null);

const token = { kind: 'node', id: 'token:tok_example' };
assert.equal(personLabel(token, []), 'Agent');
assert.equal(personLabel(token, []).includes('token:'), false);
assert.equal(personLabel({ ...token, display_name: '研究员甲' }, []), '研究员甲');
assert.equal(personLabel({ kind: 'node', id: 'node_1' }, [
  { kind: 'node', id: 'node_1', name: 'alias-only', display_name: '' },
]), 'alias-only');
assert.equal(personLabel({ kind: 'node', id: 'node_1' }, [
  { kind: 'node', id: 'node_1', name: 'alias-only', display_name: '显示名' },
]), '显示名');
assert.equal(personLabel({ kind: 'user', id: 'user_1', name: 'token:tok_example', display_name: 'Ada' }, []), 'Ada');
assert.equal(personLabel(null, []), 'Unknown');

assert.equal(matchesRequirementQuery({ id: 'req_1', name: 'Write links', seq: 918 }, ''), true);
assert.equal(matchesRequirementQuery({ id: 'req_1', name: 'Write links', seq: 918 }, '#918'), true);
assert.equal(matchesRequirementQuery({ id: 'req_1', name: 'Write links', seq: 918 }, '918'), true);
assert.equal(matchesRequirementQuery({ id: 'req_1', name: 'Write links', seq: 918 }, 'link'), true);
assert.equal(matchesRequirementQuery({ id: 'req_abcdef12', name: 'Write links', seq: 918 }, 'abcdef12'), true);
assert.equal(matchesRequirementQuery({ id: 'req_1', name: 'Write links', seq: 918 }, '#7'), false);
assert.equal(matchesRequirementQuery({ id: 'req_1', name: 'Ship the links', tags: ['portal'], description: 'dark theme' }, 'portal theme'), true);
assert.equal(matchesRequirementQuery({ id: 'req_1', name: 'Ship the links', tags: ['portal'] }, 'portal missing'), false);
assert.equal(matchesRequirementQuery({ id: 'req_1', name: '全角Ｐｏｒｔａｌ', tags: [] }, 'portal'), true);

const hubRow = normalizeRequirement({
  id: 'req_row',
  name: 'Tagged',
  seq: 12,
  column: 'doing',
  priority: 'high',
  due: '2026-10-01',
  start: '2026-09-01',
  assignee: 'Ada',
  tags: ['api', 'api'],
  agent_owner: { kind: 'node', id: 'node_1', display_name: '节点甲' },
  project_id: 'proj_1',
  participants: [{ kind: 'user', id: 'user_1', name: 'Bea' }],
  external_url: 'https://example.test/task',
  archived: true,
});
assert.equal(hubRow.tags.length, 1);
assert.equal(hubRow.tags[0], 'api');
assert.equal(hubRow.agent_owner.display_name, '节点甲');
assert.equal(hubRow.projectId, 'proj_1');
assert.equal(hubRow.participants[0].name, 'Bea');
assert.equal(hubRow.external_url, 'https://example.test/task');
assert.equal(hubRow.archived, true);
assert.deepEqual(normalizeRequirement({ id: 'x', name: 'kept', tags: ['has space is ok', 'bad\ntag'] })?.tags, []);
assert.equal(normalizeRequirement({ name: 'no id' }), null);

const noon = new Date(2026, 9, 11, 12, 0, 0).getTime();
assert.equal(isRequirementOverdue({ column: 'doing', due: '2026-10-10' }, noon), true);
assert.equal(isRequirementOverdue({ column: 'doing', due: '2026-10-11' }, noon), false);
assert.equal(isRequirementOverdue({ column: 'done', due: '2026-10-01' }, noon), false);
assert.equal(scheduleBucket({ column: 'doing', due: '2026-10-10' }, noon), 'overdue');
assert.equal(scheduleBucket({ column: 'doing', due: '2026-10-11' }, noon), 'today');
assert.equal(scheduleBucket({ column: 'pool', due: '2026-12-01' }, noon), 'later');
assert.equal(scheduleBucket({ column: 'pool', due: '' }, noon), 'none');
assert.deepEqual(
  ['low', 'high'].map((priority) => ({ priority, due: '', createdAt: '' })).sort(compareRequirements).map((row) => row.priority),
  ['high', 'low'],
);

const sunday = new Date(2026, 9, 11, 15, 0, 0).getTime();
const week = new Date(periodFromIso('week', sunday));
assert.equal(week.getDay(), 1);
assert.equal(week.getDate(), 5);
assert.equal(periodFromIso('all', sunday), null);
assert.equal(new Date(periodFromIso('today', sunday)).getDate(), 11);

const stats = readStats({
  totals: { done: 3, doing: 1, pool: 2, abandoned: 0 },
  by_completer: [{ kind: 'node', id: 'token:tok_example', n: 2, display_name: '节点甲' }],
  recent: [{ id: 'req_1', seq: 918, name: 'Ship links' }],
  daily: [{ date: '2026-10-11', n: 3 }],
});
assert.equal(stats.done, 3);
assert.equal(stats.leaders[0].display_name, '节点甲');
assert.equal(personLabel(stats.leaders[0], []), '节点甲');
assert.equal(readStats({ ok: true }), null);

const board = readFileSync(new URL('../board/BoardWorkspace.tsx', import.meta.url), 'utf8');
assert.match(board, /RequirementRef/);
const ref = readFileSync(new URL('../components/RequirementRef.tsx', import.meta.url), 'utf8');
assert.match(ref, /requirementDetailPath/);
assert.match(ref, /data-testid="requirement-seq"/);
assert.match(ref, /data-testid="requirement-title"/);

const list = readFileSync(new URL('../components/TaskList.tsx', import.meta.url), 'utf8');
assert.match(list, /\/tasks\/\$\{encodeURIComponent\(t\.task_id\)\}/);
assert.match(list, /data-testid="task-row-id"/);

const proxy = readFileSync(new URL('../../proxy.ts', import.meta.url), 'utf8');
assert.match(proxy, /'\/board', '\/board\/:path\*'/);

const route = readFileSync(new URL('../api/hub/requirements/[[...path]]/route.ts', import.meta.url), 'utf8');
assert.match(route, /X-Anet-Accept-Columns/);
assert.match(route, /abandoned/);

console.log('requirement links: PASS');
