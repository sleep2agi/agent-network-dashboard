import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTaskHistoryUrl,
  mergeTaskHistoryPage,
  oldestTaskHistoryCursor,
} from '../../app/lib/task-history-pagination.ts';

const row = (task_id: string, created_at = '2026-01-05 00:00:00', client_request_id?: string) => ({
  task_id,
  created_at,
  client_request_id,
});

test('initial history request stays bounded and cursor-free', () => {
  assert.equal(
    buildTaskHistoryUrl('agent / one', 12),
    '/api/hub/tasks?to_name=agent+%2F+one&limit=12',
  );
});

test('older history request sends the exact timestamp and task-id cursor', () => {
  const url = buildTaskHistoryUrl('agent-a', 12, row('tie-y'));
  assert.match(url, /limit=12/);
  assert.match(url, /before=2026-01-05\+00%3A00%3A00/);
  assert.match(url, /before_task_id=tie-y/);
});

test('cursor ignores local optimistic rows until a server row replaces them', () => {
  assert.deepEqual(oldestTaskHistoryCursor([
    row('tmp-request-0', '2026-01-03T00:00:00.000Z', 'request-0'),
    row('server-old', '2026-01-04 00:00:00'),
  ]), { task_id: 'server-old', created_at: '2026-01-04 00:00:00' });
  assert.equal(oldestTaskHistoryCursor([
    row('server-looking-but-unconfirmed', '2026-01-04T00:00:00.000Z', 'request-1'),
  ]), null);
});

test('incremental pages stay ordered without dropping live or same-second rows', () => {
  const current = [
    row('tie-y'),
    row('tie-z'),
    row('optimistic', '2026-01-06T00:00:00.000Z', 'request-1'),
  ];
  const olderNewestFirst = [row('tie-x'), row('old', '2026-01-04 00:00:00')];
  assert.deepEqual(mergeTaskHistoryPage(current, olderNewestFirst).map((task) => task.task_id), [
    'old',
    'tie-x',
    'tie-y',
    'tie-z',
    'optimistic',
  ]);

  const persisted = row('server-task', '2026-01-06 00:00:00', 'request-1');
  assert.deepEqual(
    mergeTaskHistoryPage(current, [persisted], new Set(['request-1'])).map((task) => task.task_id),
    ['tie-y', 'tie-z', 'server-task'],
  );
});
