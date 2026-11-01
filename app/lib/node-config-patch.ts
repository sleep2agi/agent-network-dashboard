/**
 * Pure patch-shaping for the node-config proxy (#38).
 *
 * Extracted out of app/api/anet/node-config/route.ts so the allowlists and
 * the narrowing they drive can be unit-tested without a Next request
 * context. The route imports these; behaviour is unchanged apart from the
 * channel allowlist noted below.
 */

export const EDITABLE_FLAGS = [
  'permissionMode',
  'dangerouslySkipPermissions',
  'maxTurns',
  'budget',
  'timeout',
] as const;

/**
 * Channels this UI may enable/disable. MUST equal the hub's list in
 * server/src/config-apply-validate.ts (`EDITABLE_CHANNELS`), because
 * `channels` travels as a replace-set: the panel sends the node's whole
 * desired set, not a diff.
 *
 * `commhub` used to be in here (#38). The hub never accepted it — it is the
 * RPC transport every node speaks unconditionally, so a per-node toggle
 * would be a UX lie — and dropped it silently. That mismatch is not
 * cosmetic: when a node's snapshot carries `commhub` and the user turns off
 * their only real channel, the set narrows to `["commhub"]` on the hub side,
 * which is "every entry invalid" rather than "disable all", and the hub
 * fail-closes with `channels_all_invalid`. The user asked to switch telegram
 * off and got an unreadable error instead. Filtering `commhub` here turns
 * that same save into an explicit `[]`, which is the hub's disable-all.
 */
export const EDITABLE_CHANNELS = ['telegram', 'feishu'] as const;

export type ConfigPatch = {
  model?: unknown;
  flags?: Record<string, unknown>;
  channels?: string[];
};

export type ConfigPatchInput = {
  model?: unknown;
  flags?: Record<string, unknown>;
  channels?: unknown;
};

/** Narrow an untrusted body into the fields the hub accepts. */
export function buildPatch(body: ConfigPatchInput): ConfigPatch {
  const patch: ConfigPatch = {};
  if (body.model !== undefined) patch.model = body.model;
  if (body.flags && typeof body.flags === 'object') {
    const flags: Record<string, unknown> = {};
    for (const k of EDITABLE_FLAGS) {
      if (k in body.flags && body.flags[k] !== undefined) flags[k] = body.flags[k];
    }
    if (Object.keys(flags).length > 0) patch.flags = flags;
  }
  if (Array.isArray(body.channels)) {
    const allow = new Set<string>(EDITABLE_CHANNELS);
    const seen = new Set<string>();
    const channels: string[] = [];
    for (const c of body.channels) {
      if (typeof c !== 'string') continue;
      const key = c.trim().toLowerCase();
      if (!allow.has(key) || seen.has(key)) continue;
      seen.add(key);
      channels.push(key);
    }
    patch.channels = channels;
  }
  return patch;
}
