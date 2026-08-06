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
    if (saved) setNetworkId(saved);
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
