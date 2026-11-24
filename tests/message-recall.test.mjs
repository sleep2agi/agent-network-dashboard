import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isRecalledTask,
  canRecallDashboardTask,
  markDashboardTaskRecalled,
  reeditContentOf,
} from '../app/lib/message-recall.ts';

test('isRecalledTask reads meta_json and object meta safely', () => {
  assert.equal(isRecalledTask({ status: 'cancelled', meta_json: '{"recalled":true}' }), true);
  assert.equal(isRecalledTask({ status: 'cancelled', meta: { recalled: true } }), true);
  assert.equal(isRecalledTask({ status: 'cancelled', meta_json: '{"recalled":false}' }), false);
  assert.equal(isRecalledTask({ status: 'cancelled', meta_json: '{bad-json' }), false);
  assert.equal(isRecalledTask({ status: 'delivered', meta_json: null }), false);
});

test('canRecallDashboardTask enforces ownership, non-local id, and non-terminal status', () => {
  const base = { task_id: 'task_123', status: 'delivered', content: 'hello', result: '' };
  assert.equal(canRecallDashboardTask(base, true), true);
  assert.equal(canRecallDashboardTask({ ...base, status: 'created' }, true), true);
  assert.equal(canRecallDashboardTask({ ...base, status: 'acked' }, true), true);
  assert.equal(canRecallDashboardTask({ ...base, status: 'running' }, true), true);

  assert.equal(canRecallDashboardTask(base, false), false);
  assert.equal(canRecallDashboardTask({ ...base, task_id: 'tmp-1' }, true), false);
  assert.equal(canRecallDashboardTask({ ...base, status: 'replied', result: 'ok' }, true), false);
  assert.equal(canRecallDashboardTask({ ...base, status: 'failed', result: '❌ err' }, true), false);
  assert.equal(canRecallDashboardTask({ ...base, status: 'cancelled', meta_json: '{"recalled":true}' }, true), false);
});

test('markDashboardTaskRecalled preserves existing meta and marks recalled', () => {
  const task = {
    task_id: 'task_99',
    status: 'delivered',
    content: 'original message',
    result: '',
    meta_json: JSON.stringify({ client_request_id: 'req-1' }),
  };
  const updated = markDashboardTaskRecalled(task, '2026-11-25T07:00:00Z', 'admin');
  assert.equal(updated.status, 'cancelled');
  assert.equal(updated.result, '');
  assert.equal(isRecalledTask(updated), true);
  const meta = JSON.parse(updated.meta_json);
  assert.equal(meta.client_request_id, 'req-1');
  assert.equal(meta.recalled, true);
  assert.equal(meta.recalled_at, '2026-11-25T07:00:00Z');
  assert.equal(meta.recalled_by, 'admin');
});

test('reeditContentOf strips attachment summary suffix cleanly', () => {
  assert.equal(reeditContentOf('修一下 bug\n\n[Dashboard 附件]\n- 附件: a.png (12 KB)'), '修一下 bug');
  assert.equal(reeditContentOf('纯文本消息'), '纯文本消息');
  assert.equal(reeditContentOf(''), '');
});

test('Dashboard recall proxy route and TaskChatPanel wiring exist', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const routeSrc = fs.readFileSync(path.join(root, 'app/api/hub/tasks/[id]/recall/route.ts'), 'utf8');
  assert.match(routeSrc, /requireDashboardAuth/);
  assert.match(routeSrc, /getV3UserToken/);
  assert.match(routeSrc, /\/api\/tasks\/\$\{encodeURIComponent\(id\)\}\/recall/);

  const panelSrc = fs.readFileSync(path.join(root, 'app/components/TaskChatPanel.tsx'), 'utf8');
  assert.match(panelSrc, /data-testid="chat-recalled-row"/);
  assert.match(panelSrc, /data-testid="chat-recalled-reedit"/);
  assert.match(panelSrc, /data-testid="chat-recall-btn"/);
  assert.match(panelSrc, /\/api\/hub\/tasks\/\$\{encodeURIComponent\(m\.task_id\)\}\/recall/);
});
