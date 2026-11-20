'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import useSWR from 'swr';

interface NetworkContextType {
  networkId: string;
  setNetworkId: (id: string) => void;
  /**
   * 网络解析是否已经有结论（无论结果是有值还是空）。
   *
   * 为什么需要它：`networkId` 是**异步**来的（先读 sessionStorage，否则拉 /api/hub/networks 自动选一个）。
   * 在它就绪之前发请求，就是一次**没有 scope** 的请求 —— 多网络账号下会被 400（或先渲染出默认网络的数据，
   * 随后又被正确的网络覆盖）。所以页面应该用 `ready` 把首次请求压到解析完成之后：
   *   key = ready ? scopedUrl(url, networkId) : null      // SWR 的 null key 不发起请求
   */
  ready: boolean;
}


/** 当前网络的 cookie 名：与 sessionStorage 同名，但两者独立存储。
 *  为什么要 cookie：服务端（SSR / 服务端取数）读不到 sessionStorage，
 *  而首屏要按「当前网络」过滤数据。服务端可读 cookie 之后，/nodes 才有机会把行内容随 HTML 下发。 */
const NETWORK_COOKIE = 'anet_network_id';

function readNetworkCookie(): string {
  if (typeof document === 'undefined') return '';
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${NETWORK_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(NETWORK_COOKIE.length + 1)) : '';
}

function writeNetworkCookie(id: string): void {
  if (typeof document === 'undefined') return;
  // 一年有效期、path=/、SameSite=Lax：和登录态一致，不做 HttpOnly（前端要读）
  document.cookie = `${NETWORK_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
}

const NetworkContext = createContext<NetworkContextType>({ networkId: '', setNetworkId: () => {}, ready: false });

/** 与 Sidebar 里同一个 SWR key：同 key 才能共用同一次在途请求。
 *  实测（`.640` 线上）：`fetch` 与 Sidebar 的 `useSWR` 各发一次 `/api/hub/networks`，
 *  fresh 首访变成 ×2；且**慢的那条**决定解析完成时间，把随后 4 个带 scope 的请求整体推后约 1.5s。 */
const NETWORKS_KEY = '/api/hub/networks';

interface NetworkRow { network_id?: string; network_name?: string }

const networksFetcher = async (url: string): Promise<{ networks?: NetworkRow[] }> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return { networks: [] };
  return res.json();
};

/** 上次选的网络（sessionStorage 优先，其次 cookie）。
 *  只在浏览器可用；读不到就返回空串（走"需要解析"分支）。 */
function readSavedNetwork(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromSession = sessionStorage.getItem('anet_network_id');
    if (fromSession) return fromSession;
  } catch { /* 隐私模式下 sessionStorage 可能抛错 */ }
  return readNetworkCookie();
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  // 首帧就读出「上次选的网络」：它只决定**要不要发解析请求**，不参与渲染输出，
  // 所以 SSR('') 与首帧(id) 的差异不会造成 hydration 不匹配。
  const [saved] = useState<string>(readSavedNetwork);
  const [networkId, setNetworkId] = useState('');
  const [ready, setReady] = useState(false);

  // 已有选择时不发解析请求（key=null）；没有时才走 SWR，且与 Sidebar 共用一次在途请求。
  const { data, error } = useSWR<{ networks?: NetworkRow[] }>(saved ? null : NETWORKS_KEY, networksFetcher, {
    dedupingInterval: 10000,
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });

  useEffect(() => {
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNetworkId(saved);
      setReady(true);
      return;
    }
    // 还没有结论（请求在途）：保持 ready=false，页面继续压住首次请求。
    if (data === undefined && !error) return;
    // 自动选一个：优先 default，否则第一个。没有网络可选也要 ready=true，
    // 让页面显示自己的「请选择网络」提示，而不是永远 loading。
    const list = Array.isArray(data?.networks) ? data!.networks : [];
    const pick = list.find((n) => n.network_name === 'default') || list[0];
    const id = pick?.network_id;
    if (id) {
      setNetworkId(id);
      try { sessionStorage.setItem('anet_network_id', id); } catch { /* ignore */ }
      writeNetworkCookie(id);
    }
    setReady(true);
  }, [saved, data, error]);

  const setAndPersist = (id: string) => {
    setNetworkId(id);
    sessionStorage.setItem('anet_network_id', id);
    // 写 cookie：服务端据此做首屏取数（sessionStorage 服务端读不到）
    writeNetworkCookie(id);
  };

  return (
    <NetworkContext.Provider value={{ networkId, setNetworkId: setAndPersist, ready }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetworkId() {
  return useContext(NetworkContext);
}
