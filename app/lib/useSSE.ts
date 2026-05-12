'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

interface UseSSEOptions {
  /** SSE endpoint URL */
  url: string;
  /** Callback for each event */
  onEvent?: (event: SSEEvent) => void;
  /** Auto-reconnect delay in ms (default 3000) */
  reconnectDelay?: number;
  /** Enable/disable (default true) */
  enabled?: boolean;
}

/**
 * Hook to subscribe to CommHub SSE events.
 * Falls back gracefully — if SSE fails, SWR polling continues working.
 */
export function useSSE({ url, onEvent, reconnectDelay = 3000, enabled = true }: UseSSEOptions) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unsupportedRef = useRef(false);

  // Track the active probe + cancel flag so cleanup can abort the in-flight
  // HEAD and prevent the EventSource from being created after unmount. Without
  // this, every navigation leaks one SSE — six leaks saturate the browser's
  // HTTP/1.1 pool and lock up further fetches (including RSC payloads).
  const probeAbortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  // Hold onEvent in a ref so callers can pass an inline callback without it
  // forcing the EventSource to tear down on every render. Production hit
  // this — page.tsx re-renders on each SWR mutate, the inline onEvent had a
  // new identity each time, useCallback's deps changed, useEffect cleaned up
  // and reconnected. Each render opened a fresh /events/<alias> upstream;
  // the hub saw 1500+ "admin connected" within minutes and stalled mcp/tools.
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const connect = useCallback(() => {
    if (!enabled || !url || unsupportedRef.current || cancelledRef.current) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (probeAbortRef.current) probeAbortRef.current.abort();

    const probeUrl = url.includes('?') ? `${url}&probe=1` : `${url}?probe=1`;
    const probeController = new AbortController();
    probeAbortRef.current = probeController;
    const probeTimeout = setTimeout(() => probeController.abort(), 5000);

    fetch(probeUrl, { method: 'HEAD', cache: 'no-store', signal: probeController.signal })
      .finally(() => clearTimeout(probeTimeout))
      .then((res) => {
        if (cancelledRef.current) return;
        if (res.headers.get('x-anet-sse-available') !== 'true') {
          unsupportedRef.current = true;
          setConnected(false);
          setSupported(false);
          return;
        }

        setSupported(true);
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => setConnected(true);

        es.onmessage = (e) => {
          try {
            const data: SSEEvent = JSON.parse(e.data);
            setLastEvent(data);
            onEventRef.current?.(data);
          } catch {}
        };

        es.onerror = () => {
          setConnected(false);
          es.close();
          eventSourceRef.current = null;
          if (!cancelledRef.current) {
            reconnectTimerRef.current = setTimeout(connect, reconnectDelay);
          }
        };
      })
      .catch(() => {
        if (cancelledRef.current) return;
        setConnected(false);
        setSupported(false);
      });
  }, [url, reconnectDelay, enabled]);

  useEffect(() => {
    unsupportedRef.current = false;
    cancelledRef.current = false;
    setSupported(enabled ? null : false);
    connect();
    return () => {
      cancelledRef.current = true;
      if (probeAbortRef.current) {
        probeAbortRef.current.abort();
        probeAbortRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return { connected, lastEvent, supported };
}
