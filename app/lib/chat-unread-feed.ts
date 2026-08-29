/**
 * Pure helpers behind the unread badge's message feed.
 *
 * Kept free of React/SWR so the merge and identity rules can be unit-tested
 * directly; `chat-unread.ts` is the hook that uses them.
 */

export interface UnreadFeedMessage {
  id?: string | null;
  from_alias?: string | null;
  to_alias?: string | null;
  created_at?: string | null;
}

const AUTH_KEY = 'anet_v3_auth';

/**
 * The dashboard user's own alias, as the hub knows it.
 *
 * The hub derives `from_name` from the caller's token when the dashboard
 * omits it (app/api/hub/send/route.ts sends no from_session), so replies and
 * messages come back addressed to the username — which is also the SSE
 * channel app/api/hub/events/route.ts subscribes to. Returns null when the
 * client has no identity snapshot yet; callers must treat that as "don't
 * scope", never as "scope to nobody".
 */
export function currentUserAlias(
  session: Storage | undefined = typeof window === 'undefined' ? undefined : window.sessionStorage,
): string | null {
  if (!session) return null;
  try {
    const auth = JSON.parse(session.getItem(AUTH_KEY) || 'null');
    const name = auth?.user?.username;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Merge the network-wide feed with the user's own inbox feed, newest first,
 * one entry per message id.
 *
 * Why two feeds at all: the network-wide fetch is capped at N rows, and on a
 * busy fleet those rows are mostly agent-to-agent chatter, so messages
 * addressed to the user can be pushed out of the window and never counted.
 * The inbox-scoped fetch spends its whole window on the user's own mail.
 *
 * Why not just the scoped one: `alias=` filters the hub query to a single
 * recipient string, while the dashboard treats several spellings as "the
 * user" (see USERISH in chat-unread.ts). Dropping the wide feed would
 * silently lose anything addressed to one of the others. Merging is
 * fail-open — the scoped feed can only add.
 *
 * Rows without an id cannot be deduped, so they are kept as-is; the hub
 * always sends one, and inventing a synthetic key would risk collapsing two
 * real messages into one (an undercount, the failure this whole path exists
 * to prevent).
 */
export function mergeMessageFeeds(
  ...feeds: Array<UnreadFeedMessage[] | undefined | null>
): UnreadFeedMessage[] {
  const byId = new Map<string, UnreadFeedMessage>();
  const idless: UnreadFeedMessage[] = [];
  for (const feed of feeds) {
    for (const message of feed || []) {
      const id = typeof message?.id === 'string' ? message.id : null;
      if (!id) { idless.push(message); continue; }
      if (!byId.has(id)) byId.set(id, message);
    }
  }
  return [...byId.values(), ...idless];
}
