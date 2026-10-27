'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

const NetworkContext = createContext<NetworkContextType>({ networkId: '', setNetworkId: () => {}, ready: false });

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkId, setNetworkId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem('anet_network_id');
    // Hydration-safe restore (see UserBar note).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) { setNetworkId(saved); setReady(true); return; }
    // No prior selection: auto-select the user's first/default network so
    // network-scoped pages (e.g. /scheduled-tasks) don't dead-end on a
    // "请先在左侧选择一个网络" error and hide existing schedules/nodes when
    // the user has exactly one network. Persist so it's stable this session.
    let cancelled = false;
    fetch('/api/hub/networks', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { networks: [] }))
      .then((d: { networks?: { network_id?: string; network_name?: string }[] }) => {
        if (cancelled) return;
        const list = Array.isArray(d.networks) ? d.networks : [];
        const pick = list.find(n => n.network_name === 'default') || list[0];
        const id = pick?.network_id;
        if (id) {
          setNetworkId(id);
          try { sessionStorage.setItem('anet_network_id', id); } catch { /* ignore */ }
        }
        // 有值没值都算「解析结束」：没有网络可选的用户也要能看到页面自己的「请选择网络」提示，
        // 而不是永远停在 loading。
        setReady(true);
      })
      .catch(() => { /* leave unselected; page shows its own prompt */ })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const setAndPersist = (id: string) => {
    setNetworkId(id);
    sessionStorage.setItem('anet_network_id', id);
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
