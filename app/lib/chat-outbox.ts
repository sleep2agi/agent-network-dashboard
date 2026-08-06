'use client';

export const CHAT_OUTBOX_PREFIX = 'anet_chat_outbox_v2:';
export const CHAT_DRAFT_PREFIX = 'anet_chat_draft_v2:';
const LEGACY_PRIVATE_PREFIXES = ['anet_chat_outbox_v1', 'anet_chat_draft_v1:'];
const AUTH_KEY = 'anet_v3_auth';
const MAX_ENTRIES = 100;
const MAX_CONTENT_BYTES = 32 * 1024;
const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

/** Scope plaintext chat recovery data to the authenticated user and network.
 *  If the client has no trustworthy identity snapshot, persistence is disabled. */
export function chatPrivateScope(
  networkId?: string | null,
  session: Storage | undefined = typeof window === 'undefined' ? undefined : window.sessionStorage,
): string | null {
  if (!session) return null;
  try {
    const auth = JSON.parse(session.getItem(AUTH_KEY) || 'null');
    const identity = auth?.user?.user_id || auth?.user?.username;
    const network = networkId || session.getItem('anet_network_id') || auth?.currentNetwork;
    if (typeof identity !== 'string' || !identity || typeof network !== 'string' || !network) return null;
    return `${encodeURIComponent(identity)}:${encodeURIComponent(network)}`;
  } catch {
    return null;
  }
}

/** Explicit logout removes every account/network shard and legacy plaintext. */
export function clearPrivateChatStorage(
  storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && (
        key.startsWith(CHAT_OUTBOX_PREFIX)
        || key.startsWith(CHAT_DRAFT_PREFIX)
        || LEGACY_PRIVATE_PREFIXES.some(prefix => key.startsWith(prefix))
      )) keys.push(key);
    }
    for (const key of keys) {
      storage.removeItem(key);
      removed += 1;
    }
  } catch {
    // Storage errors must not block logout.
  }
  return removed;
}

export interface ChatOutboxEntry {
  requestId: string;
  localTaskId: string;
  panelAlias: string;
  targetAlias: string;
  content: string;
  priority: string;
  networkId: string;
  createdAt: string;
}

function valid(entry: unknown): entry is ChatOutboxEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Partial<ChatOutboxEntry>;
  return typeof e.requestId === 'string' && /^dreq_[A-Za-z0-9_-]{16,96}$/.test(e.requestId)
    && typeof e.localTaskId === 'string'
    && typeof e.panelAlias === 'string'
    && typeof e.targetAlias === 'string'
    && typeof e.content === 'string' && new TextEncoder().encode(e.content).byteLength <= MAX_CONTENT_BYTES
    && typeof e.priority === 'string'
    && typeof e.networkId === 'string'
    && typeof e.createdAt === 'string';
}

function storageKey(scope: string) { return CHAT_OUTBOX_PREFIX + scope; }

export function readChatOutbox(
  scope: string | null = chatPrivateScope(),
  storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
  now = Date.now(),
): ChatOutboxEntry[] {
  if (!storage || !scope) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(scope)) || '[]');
    if (!Array.isArray(parsed)) return [];
    const live = parsed.filter(valid).filter(entry => {
      const created = Date.parse(entry.createdAt);
      return Number.isFinite(created) && created <= now && now - created <= OUTBOX_TTL_MS;
    }).slice(-MAX_ENTRIES);
    // TTL is a storage lifecycle, not merely a display filter: erase expired,
    // malformed, and oversized plaintext opportunistically on every read.
    if (live.length !== parsed.length) write(storage, scope, live);
    return live;
  } catch {
    return [];
  }
}

function write(storage: Storage, scope: string, entries: ChatOutboxEntry[]): boolean {
  try {
    storage.setItem(storageKey(scope), JSON.stringify(entries.slice(-MAX_ENTRIES)));
    return true;
  } catch {
    // Storage can be disabled, full, or unavailable in a privacy-restricted
    // webview. The outbox is a recovery enhancement and must never prevent
    // the actual network send.
    return false;
  }
}

export function putChatOutbox(
  entry: ChatOutboxEntry,
  scope: string | null = chatPrivateScope(entry.networkId),
  storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
) {
  if (!storage || !scope || !valid(entry)) return false;
  const next = readChatOutbox(scope, storage).filter(item => item.requestId !== entry.requestId);
  next.push(entry);
  return write(storage, scope, next);
}

export function removeChatOutbox(
  requestId: string,
  scope: string | null = chatPrivateScope(),
  storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
) {
  if (!storage || !scope) return false;
  return write(storage, scope, readChatOutbox(scope, storage).filter(item => item.requestId !== requestId));
}

export function chatOutboxForAlias(
  alias: string,
  scope: string | null = chatPrivateScope(),
  storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
) {
  return readChatOutbox(scope, storage).filter(item => item.panelAlias === alias);
}
