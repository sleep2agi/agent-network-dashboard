'use client';

import { useSyncExternalStore } from 'react';

/* Loop R24 (Vincent 亲点: 头像换血) — custom avatar infrastructure.
 *
 * Resolution order, per alias (通信龙 裁定, avatar 接线单 07-31):
 *   1. hub avatar_url — nodes.avatar_url via GET /api/hub/nodes, hydrated
 *      by useNodeLifecycle → hydrateHubAvatars(). The hub is the
 *      CROSS-DEVICE truth, so it sits ABOVE localStorage (which is only a
 *      per-browser cache); the pre-wiring order caused the "改了头像别人
 *      看不到" stuck-avatar report.
 *      Evidence the hub side exists (this comment previously claimed it
 *      didn't — that stale claim is WHY nobody wired this for weeks):
 *      hub #462 shipped PUT /api/nodes/:ref/avatar (server.ts:2477,
 *      validated by avatar-validate.ts) + nodes.avatar_url column
 *      (db.ts:346) + the GET projection (server.ts:2784).
 *   2. user override — localStorage map, set in the node settings UI
 *      (which now ALSO PUTs to the hub; localStorage is the echo)
 *   3. designed default — /avatars/manifest.json (static, alias → URL)
 *   4. shared pool — manifest "_pool"; stable djb2 pick per alias
 *   5. '' → caller falls back to the hue-hashed initial pill
 */

const STORE_KEY = 'anet_avatars_v1';
const AVATAR_EVENT = 'anet-avatars-updated';

let hubMap: Record<string, string> = {};
/** Aliases that HAVE a nodes row — for them the hub is the whole truth,
 *  INCLUDING "cleared" (avatar_url null): a stale localStorage override on
 *  another device must not resurrect the old picture (clear-consistency
 *  gap, #72 review follow-up / 通信龙 批准). Session-only aliases keep
 *  localStorage as their only personalization. */
let hubNodeAliases: Set<string> = new Set();
let hubMapKey = ''; // change detector — avoid event storms on every poll

/** Feed nodes from GET /api/hub/nodes into the resolution chain (layer 1).
 *  Cheap to call on every SWR poll: only dispatches when content changed. */
export function hydrateHubAvatars(nodes: Array<{ alias?: string; avatar_url?: string | null }> | undefined) {
  if (!nodes) return;
  const next: Record<string, string> = {};
  const nextAliases = new Set<string>();
  for (const n of nodes) {
    if (!n.alias) continue;
    nextAliases.add(n.alias);
    if (typeof n.avatar_url === 'string' && n.avatar_url) next[n.alias] = n.avatar_url;
  }
  const key = JSON.stringify(next) + '|' + [...nextAliases].sort().join(',');
  if (key === hubMapKey) return;
  hubMapKey = key;
  hubMap = next;
  hubNodeAliases = nextAliases;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AVATAR_EVENT));
}

let manifest: Record<string, string> | null = null;
let pool: string[] = [];
let manifestRequested = false;

/* Stable per-alias index so a given agent keeps the same pool avatar across
 * sessions/devices (djb2 over code units — no Math.random, no ordering). */
function poolPick(alias: string): string {
  if (!pool.length) return '';
  let h = 5381;
  for (let i = 0; i < alias.length; i++) h = ((h << 5) + h + alias.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

function fetchManifestOnce() {
  if (manifestRequested || typeof window === 'undefined') return;
  manifestRequested = true;
  fetch('/avatars/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
          if (k.startsWith('_')) continue; // meta keys ("_pool", …)
          if (typeof v === 'string' && v.startsWith('/')) clean[k] = v;
        }
        const rawPool = (j as Record<string, unknown>)._pool;
        pool = Array.isArray(rawPool)
          ? rawPool.filter((p): p is string => typeof p === 'string' && p.startsWith('/'))
          : [];
        manifest = clean;
        window.dispatchEvent(new Event(AVATAR_EVENT));
      }
    })
    .catch(() => {});
}

function readMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getAvatarUrl(alias?: string | null): string {
  if (!alias) return '';
  // Node-backed: hub authority — its value, or (when cleared/none) the
  // designed default chain, SKIPPING localStorage entirely.
  if (hubNodeAliases.has(alias)) {
    return hubMap[alias] || manifest?.[alias] || poolPick(alias) || '';
  }
  // Session-only: localStorage is the only personalization layer.
  return readMap()[alias] || manifest?.[alias] || poolPick(alias) || '';
}

/** Empty/whitespace url removes the override (falls back to manifest/pill). */
export function setAvatarUrl(alias: string, url: string) {
  if (typeof window === 'undefined' || !alias) return;
  try {
    const m = readMap();
    if (url.trim()) m[alias] = url.trim();
    else delete m[alias];
    window.localStorage.setItem(STORE_KEY, JSON.stringify(m));
    window.dispatchEvent(new Event(AVATAR_EVENT));
  } catch {}
}

let version = 0;
function subscribe(callback: () => void) {
  fetchManifestOnce();
  const bump = () => { version++; callback(); };
  window.addEventListener(AVATAR_EVENT, bump);
  window.addEventListener('storage', bump);
  return () => {
    window.removeEventListener(AVATAR_EVENT, bump);
    window.removeEventListener('storage', bump);
  };
}

/** Monotonic version for callers that resolve many aliases via plain
 *  getAvatarUrl() inside render loops (map callbacks can't call hooks —
 *  same idiom as chat-mute's useMuteVersion). Subscribing also kicks off
 *  the lazy manifest fetch and re-renders the caller when it lands. */
export function useAvatarsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

export function useAvatarUrl(alias?: string | null): string {
  return useSyncExternalStore(subscribe, () => getAvatarUrl(alias), () => '');
}
