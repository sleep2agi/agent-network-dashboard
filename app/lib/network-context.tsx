'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface NetworkContextType {
  networkId: string;
  setNetworkId: (id: string) => void;
}

const NetworkContext = createContext<NetworkContextType>({ networkId: '', setNetworkId: () => {} });

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkId, setNetworkId] = useState('');

  useEffect(() => {
    const saved = sessionStorage.getItem('anet_network_id');
    // Hydration-safe restore (see UserBar note).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) { setNetworkId(saved); return; }
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
      })
      .catch(() => { /* leave unselected; page shows its own prompt */ });
    return () => { cancelled = true; };
  }, []);

  const setAndPersist = (id: string) => {
    setNetworkId(id);
    sessionStorage.setItem('anet_network_id', id);
  };

  return (
    <NetworkContext.Provider value={{ networkId, setNetworkId: setAndPersist }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetworkId() {
  return useContext(NetworkContext);
}
