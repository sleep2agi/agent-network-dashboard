import assert from 'node:assert/strict';
import test from 'node:test';
import { chatPrivateScope, clearPrivateChatStorage } from '../../app/lib/chat-outbox.ts';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test('scope is derived from authenticated user and explicit network', () => {
  const session = new MemoryStorage();
  session.setItem('anet_v3_auth', JSON.stringify({
    user: { user_id: 'user/a', username: 'alice' }, currentNetwork: 'net_old',
  }));
  assert.equal(chatPrivateScope('net/b', session), 'user%2Fa:net%2Fb');
});

test('missing identity disables plaintext persistence', () => {
  assert.equal(chatPrivateScope('net_a', new MemoryStorage()), null);
});

test('logout clears old and scoped outbox/draft keys but preserves unrelated preferences', () => {
  const storage = new MemoryStorage();
  for (const key of [
    'anet_chat_outbox_v1',
    'anet_chat_outbox_v2:user_a:net_a',
    'anet_chat_draft_v1:worker',
    'anet_chat_draft_v2:user_a:net_a:worker',
  ]) storage.setItem(key, 'secret text');
  storage.setItem('anet-theme', 'cyber');
  assert.equal(clearPrivateChatStorage(storage), 4);
  assert.equal(storage.length, 1);
  assert.equal(storage.getItem('anet-theme'), 'cyber');
});
