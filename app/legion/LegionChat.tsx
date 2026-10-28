'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { TaskChatPanel } from '../components/TaskChatPanel';
import { AliasAvatar } from '../components/AliasAvatar';
import { CHAT_COLLAPSED_HEIGHT, fitChatWindow, initialChatWindow, type ChatWindowRect } from './legion-chat-window';
import styles from './legion-chat.module.css';

/** Lives inside the scene's fullscreen element. Unmount on network/target change. */
export function LegionChat({ alias, networkId, onClose }: {
  alias: string; networkId: string; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<ChatWindowRect | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [focused, setFocused] = useState(false);
  const boundsRef = useRef<ChatWindowRect>({ x: 0, y: 0, width: 480, height: 620 });
  const minimizedRef = useRef(false);
  const pointer = useRef<{ id: number; x: number; y: number; rect: ChatWindowRect; resize: boolean } | null>(null);
  // Keep mentions scoped, so TaskChatPanel never fetches the global alias→network map.
  const availableNodes = useMemo(() => [alias], [alias]);
  const placed = rect !== null;
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const measure = () => {
      const host = layer.getBoundingClientRect(), visual = window.visualViewport;
      const left = Math.max(0, (visual?.offsetLeft ?? 0) - host.left) + 12;
      const top = Math.max(0, (visual?.offsetTop ?? 0) - host.top) + 12;
      const right = Math.min(host.width, (visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth) - host.left) - 12;
      const bottom = Math.min(host.height, (visual?.offsetTop ?? 0) + (visual?.height ?? innerHeight) - host.top) - 12;
      const bounds = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      boundsRef.current = bounds;
      pointer.current = null;
      setRect(previous => previous ? fitChatWindow(previous, bounds, minimizedRef.current) : initialChatWindow(bounds));
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(layer);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    document.addEventListener('fullscreenchange', measure);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure);
      window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure);
      document.removeEventListener('fullscreenchange', measure);
    };
  }, []);
  useEffect(() => {
    if (!placed) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stage = dialogRef.current?.closest<HTMLElement>('[data-legion-stage]');
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      else stage?.focus({ preventScroll: true });
    };
  }, [placed]);

  const start = (event: PointerEvent<HTMLButtonElement>, resize: boolean) => {
    if (event.button !== 0 || !event.isPrimary || !rect) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect, resize };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    if (!(event.buttons & 1)) { pointer.current = null; return; }
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    setRect(fitChatWindow(active.resize ? { ...active.rect, width: active.rect.width + dx, height: active.rect.height + dy }
      : { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }, boundsRef.current, minimized));
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, resize: boolean) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { setRect(initialChatWindow(boundsRef.current)); return; }
    const step = event.shiftKey ? 40 : 10;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    setRect(previous => previous && fitChatWindow(resize ? { ...previous, width: previous.width + dx, height: previous.height + dy }
      : { ...previous, x: previous.x + dx, y: previous.y + dy }, boundsRef.current, minimized));
  };
  const toggle = () => {
    const next = !minimized; minimizedRef.current = next; pointer.current = null;
    setRect(previous => previous && fitChatWindow(previous, boundsRef.current, next));
    setMinimized(next);
  };
  const pointerHandlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: () => { pointer.current = null; } };

  return (
    <div ref={layerRef} className={`fixed inset-0 ${styles.layer}`} data-testid="legion-chat-overlay">
      <div
        ref={dialogRef} role="dialog" aria-label={`与 ${alias} 对话`}
        data-testid="legion-chat" data-network-id={networkId}
        data-minimized={minimized}
        className={styles.window}
        style={rect ? { left: rect.x, top: rect.y, width: minimized ? Math.min(340, rect.width) : rect.width,
          height: minimized ? Math.min(CHAT_COLLAPSED_HEIGHT, rect.height) : rect.height } : { visibility: 'hidden' }}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
        onPointerDown={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
        onKeyDown={e => {
          e.stopPropagation(); // typing R/F/? must never reach scene shortcuts
          if (e.defaultPrevented || (e.target as HTMLElement).closest('[role="dialog"]') !== e.currentTarget) return;
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
      >
        <header className={styles.header}>
          <button type="button" className={styles.move} aria-label="移动对话窗口" title="拖动移动；方向键微调，Home 归位"
            data-testid="legion-chat-move" onPointerDown={event => start(event, false)} {...pointerHandlers} onKeyDown={event => keyboard(event, false)}>
            <AliasAvatar alias={alias} size={30} />
            <span className="min-w-0 flex-1"><span className={styles.title} title={alias}>{alias}</span>
              <span className={styles.hint}>{minimized ? '对话已收起' : '浮窗对话 · 拖动标题栏移动'}</span></span>
          </button>
          <button type="button" className={styles.control} onClick={toggle} aria-label={minimized ? '展开对话' : '收起对话'}
            aria-expanded={!minimized} data-testid="legion-chat-minimize" title={minimized ? '展开对话' : '收起对话'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              {minimized ? <path d="M5 5h14v14H5zM5 9h14" /> : <path d="M5 17h14" />}
            </svg>
          </button>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭对话"
            className={styles.control} data-testid="legion-chat-close" title="关闭对话 (Esc)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <div className={styles.body} hidden={minimized}>
          <TaskChatPanel alias={alias} onClose={onClose} inline active={!minimized} keyboardActive={!minimized && focused}
            autoFocus={false} availableNodes={availableNodes} scopeNetworkId={networkId} />
        </div>
        {!minimized && <footer className={styles.footer}>
          <span>可同时操作军团图</span>
          <button type="button" className={`${styles.control} ${styles.resize}`} aria-label="调整对话窗口大小" title="拖动调整大小；方向键微调"
            data-testid="legion-chat-resize" onPointerDown={event => start(event, true)} {...pointerHandlers} onKeyDown={event => keyboard(event, true)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m5 14 9-9m-4 9 4-4" /></svg>
          </button>
        </footer>}
      </div>
    </div>
  );
}
