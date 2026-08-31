import { describe, expect, test } from 'bun:test';
import { EDITABLE_CHANNELS, buildPatch } from './node-config-patch';

// #38 — `channels` travels as a replace-set: the panel sends the node's whole
// desired set. So the dashboard's allowlist decides what reaches the hub, and
// it MUST equal the hub's (server/src/config-apply-validate.ts EDITABLE_CHANNELS
// = {telegram, feishu}).
//
// Gate discipline: asserting the literal list alone would only prove someone
// edited a constant. Every test below asserts the NARROWED OUTPUT, and the
// decisive one is the disable-all case — that is where the old list turned a
// working save into a hub-side `channels_all_invalid`.
describe('#38 node-config patch narrowing', () => {
  test('the allowlist matches the hub — commhub is not a per-node channel', () => {
    expect([...EDITABLE_CHANNELS].sort()).toEqual(['feishu', 'telegram']);
  });

  test('commhub is dropped alongside a real channel', () => {
    // Before #38 this forwarded commhub, and the hub silently discarded it.
    expect(buildPatch({ channels: ['commhub', 'telegram'] }).channels).toEqual(['telegram']);
  });

  test('turning off the last real channel narrows to an explicit disable-all', () => {
    // The decisive case. Before #38 this produced ["commhub"], which the hub
    // reads as "every entry invalid" and rejects with channels_all_invalid —
    // so the user could not switch their only channel off. [] is the hub's
    // documented disable-all.
    expect(buildPatch({ channels: ['commhub'] }).channels).toEqual([]);
  });

  test('an explicit empty set stays empty, and is distinct from "absent"', () => {
    expect(buildPatch({ channels: [] }).channels).toEqual([]);
    expect(buildPatch({}).channels).toBeUndefined();
  });

  test('hostile entries are narrowed the same way the hub narrows them', () => {
    expect(buildPatch({ channels: [' TeleGram ', 'telegram', 'telegarm', 42, null] }).channels)
      .toEqual(['telegram']);
    expect(buildPatch({ channels: 'telegram' }).channels).toBeUndefined();
  });

  test('flags stay on their own allowlist and drop unknown keys', () => {
    expect(buildPatch({ flags: { permissionMode: 'auto', nope: 1 } }).flags)
      .toEqual({ permissionMode: 'auto' });
    expect(buildPatch({ flags: {} }).flags).toBeUndefined();
  });

  test('model passes through untouched', () => {
    expect(buildPatch({ model: 'gpt-5.5' }).model).toBe('gpt-5.5');
    expect(buildPatch({}).model).toBeUndefined();
  });
});
