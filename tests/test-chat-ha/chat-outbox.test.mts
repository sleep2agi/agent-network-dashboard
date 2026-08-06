import assert from 'node:assert/strict';
import test from 'node:test';
import { chatOutboxForAlias, putChatOutbox, readChatOutbox, removeChatOutbox } from '../../app/lib/chat-outbox.ts';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const entry = {
  requestId: 'dreq_0123456789abcdef',
  localTaskId: 'tmp-dreq_0123456789abcdef',
  panelAlias: 'worker',
  targetAlias: 'worker',
  content: 'ship it',
  priority: 'normal',
  networkId: 'net_a',
  createdAt: '2026-08-03T12:00:00.000Z',
};
const SCOPE = 'user_a:net_a';

test('pending text send survives reload and can be removed by request id', () => {
  const storage = new MemoryStorage();
  putChatOutbox(entry, SCOPE, storage);
  assert.deepEqual(chatOutboxForAlias('worker', SCOPE, storage), [entry]);
  removeChatOutbox(entry.requestId, SCOPE, storage);
  assert.deepEqual(readChatOutbox(SCOPE, storage), []);
});

test('same request id is upserted rather than duplicated', () => {
  const storage = new MemoryStorage();
  putChatOutbox(entry, SCOPE, storage);
  putChatOutbox({ ...entry, content: 'updated' }, SCOPE, storage);
  assert.equal(readChatOutbox(SCOPE, storage).length, 1);
  assert.equal(readChatOutbox(SCOPE, storage)[0]?.content, 'updated');
});

test('malformed storage fails closed to an empty outbox', () => {
  const storage = new MemoryStorage();
  storage.setItem(`anet_chat_outbox_v2:${SCOPE}`, '{bad');
  assert.deepEqual(readChatOutbox(SCOPE, storage), []);
});

test('unavailable or full storage never throws and cannot block the send path', () => {
  const storage = {
    getItem: () => '[]',
    setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
  } as Storage;
  assert.equal(putChatOutbox(entry, SCOPE, storage), false);
  assert.equal(removeChatOutbox('dreq_0123456789abcdef', SCOPE, storage), false);
});

test('identity and network shards cannot read each other', () => {
  const storage = new MemoryStorage();
  putChatOutbox(entry, 'user_a:net_a', storage);
  assert.equal(readChatOutbox('user_b:net_a', storage).length, 0);
  assert.equal(readChatOutbox('user_a:net_b', storage).length, 0);
  assert.equal(readChatOutbox('user_a:net_a', storage).length, 1);
});

test('expired and oversized plaintext is neither persisted nor restored', () => {
  const storage = new MemoryStorage();
  const now = Date.parse('2026-08-03T13:00:00.000Z');
  const expired = { ...entry, createdAt: '2026-08-01T12:00:00.000Z' };
  storage.setItem(`anet_chat_outbox_v2:${SCOPE}`, JSON.stringify([expired]));
  assert.deepEqual(readChatOutbox(SCOPE, storage, now), []);
  assert.equal(storage.getItem(`anet_chat_outbox_v2:${SCOPE}`), '[]');
  assert.equal(putChatOutbox({ ...entry, content: 'x'.repeat(32 * 1024 + 1) }, SCOPE, storage), false);
  assert.equal(putChatOutbox({ ...entry, content: '界'.repeat(11_000) }, SCOPE, storage), false,
    'limit is UTF-8 bytes, not JavaScript character count');
});
