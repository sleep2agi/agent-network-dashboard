import { describe, expect, test } from 'bun:test';
import { currentUserAlias, mergeMessageFeeds } from './chat-unread-feed';

const store = (data) => ({
  getItem: (k) => (k in data ? data[k] : null),
});

// The unread badge counts rows out of these feeds, so the merge decides what
// can be counted at all. Assertions target the merged OUTPUT, not the shape
// of the inputs: an undercount here shows up as a badge that stays at 0 while
// a message is sitting there, which is the failure this path exists to stop.
describe('unread feed merge', () => {
  test('the scoped feed adds rows the wide feed lost to its row cap', () => {
    const wide = [{ id: 'a' }, { id: 'b' }];
    const inbox = [{ id: 'b' }, { id: 'c' }];
    expect(mergeMessageFeeds(wide, inbox).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  test('a message present in both feeds is counted once', () => {
    const dupe = { id: 'x', from_alias: 'agent' };
    expect(mergeMessageFeeds([dupe], [dupe], [dupe])).toHaveLength(1);
  });

  test('the first copy wins, so a row never changes shape mid-merge', () => {
    const merged = mergeMessageFeeds([{ id: 'x', from_alias: 'first' }], [{ id: 'x', from_alias: 'second' }]);
    expect(merged).toEqual([{ id: 'x', from_alias: 'first' }]);
  });

  test('missing or empty feeds are not an error — the other feed still counts', () => {
    expect(mergeMessageFeeds(undefined, [{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(mergeMessageFeeds(null, undefined)).toEqual([]);
    expect(mergeMessageFeeds()).toEqual([]);
  });

  test('id-less rows are kept rather than collapsed into each other', () => {
    // Two distinct messages with no id must stay two. Keying them on
    // anything synthetic would merge them and undercount.
    const merged = mergeMessageFeeds([{ from_alias: 'a' }, { from_alias: 'b' }]);
    expect(merged).toHaveLength(2);
  });
});

describe('current user alias', () => {
  test('reads the username out of the auth snapshot', () => {
    expect(currentUserAlias(store({ anet_v3_auth: JSON.stringify({ user: { username: 'admin' } }) }))).toBe('admin');
    expect(currentUserAlias(store({ anet_v3_auth: JSON.stringify({ user: { username: '  admin  ' } }) }))).toBe('admin');
  });

  test('no identity yet returns null — callers must not scope to nobody', () => {
    // Each of these means "unknown", and unknown must never narrow the query
    // to an empty alias, which would return an empty inbox and read as
    // "no unread".
    expect(currentUserAlias(store({}))).toBeNull();
    expect(currentUserAlias(store({ anet_v3_auth: 'not json' }))).toBeNull();
    expect(currentUserAlias(store({ anet_v3_auth: JSON.stringify({ user: {} }) }))).toBeNull();
    expect(currentUserAlias(store({ anet_v3_auth: JSON.stringify({ user: { username: '   ' } }) }))).toBeNull();
    expect(currentUserAlias(undefined)).toBeNull();
  });
});

// #40：收件人判定必须认「登录用户名」。hub 把回复/消息写给 token 里的
// username，而通用标签只有那几个 —— 只认标签会让角标永远不亮。
describe('谁算「发给我的」', () => {
  test('通用标签算', async () => {
    const { isUserRecipient } = await import('./chat-unread-feed');
    for (const v of ['', 'Dashboard', 'api', 'admin', 'hub', ' Hub ']) expect(isUserRecipient(v, 'vansin')).toBe(true);
  });

  test('登录用户名也算（大小写/空格无关）', async () => {
    const { isUserRecipient } = await import('./chat-unread-feed');
    expect(isUserRecipient('vansin', 'vansin')).toBe(true);
    expect(isUserRecipient(' Vansin ', 'vansin')).toBe(true);
  });

  test('不知道我是谁时只认标签，绝不放宽成「任何人」', async () => {
    const { isUserRecipient } = await import('./chat-unread-feed');
    expect(isUserRecipient('vansin', null)).toBe(false);
    expect(isUserRecipient('someone-else', 'vansin')).toBe(false);
  });

  test('自己发出的消息永远不算未读', async () => {
    const { isUserSender } = await import('./chat-unread-feed');
    expect(isUserSender('vansin', 'vansin')).toBe(true);
    expect(isUserSender('api', null)).toBe(true);
    expect(isUserSender('agent-a', 'vansin')).toBe(false);
  });
});
