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
