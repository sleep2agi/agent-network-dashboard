import assert from 'node:assert/strict';
import test from 'node:test';
import { newDashboardRequestId, normalizeChatSendResult, requestIdFromTaskMeta } from '../../app/lib/chat-send-state.ts';

test('offline-but-queued is accepted and shown as queued, not failed', () => {
  assert.deepEqual(normalizeChatSendResult({
    ok: false, error: 'alias_offline', queued: true, message_id: 'task-1',
  }), { accepted: true, messageId: 'task-1', status: 'queued' });
});

test('a transport error without a message id is never reported as accepted', () => {
  assert.deepEqual(normalizeChatSendResult({ ok: false, error: 'delivery_unknown' }), { accepted: false });
});

test('persisted task metadata reconciles the matching outbox request', () => {
  assert.equal(requestIdFromTaskMeta(JSON.stringify({
    source: 'dashboard-chat', client_request_id: 'dreq_0123456789abcdef',
  })), 'dreq_0123456789abcdef');
  assert.equal(requestIdFromTaskMeta('{bad'), null);
});

test('request id falls back to getRandomValues when randomUUID is unavailable', () => {
  const fakeCrypto = {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      const bytes = array as Uint8Array;
      bytes.fill(0xab);
      return array;
    },
  } as Crypto;
  assert.equal(newDashboardRequestId(fakeCrypto), `dreq_${'ab'.repeat(16)}`);
});
