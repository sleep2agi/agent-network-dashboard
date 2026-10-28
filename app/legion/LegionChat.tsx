'use client';

import { useEffect, useMemo, useRef } from 'react';
import { TaskChatPanel } from '../components/TaskChatPanel';
import { AliasAvatar } from '../components/AliasAvatar';

/** Lives inside the scene's fullscreen element. Unmount on network/target change. */
export function LegionChat({ alias, networkId, onClose, viewport = false }: {
  alias: string; networkId: string; onClose: () => void; viewport?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Keep mentions scoped, so TaskChatPanel never fetches the global alias→network map.
  const availableNodes = useMemo(() => [alias], [alias]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stage = dialogRef.current?.closest<HTMLElement>('[data-legion-stage]');
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else stage?.focus();
    };
  }, []);

  return (
    <div className={`${viewport ? 'fixed' : 'absolute'} inset-0 z-50 flex justify-end bg-[var(--bg)]/45`} data-testid="legion-chat-overlay">
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-label={`与 ${alias} 对话`}
        data-testid="legion-chat" data-network-id={networkId}
        className="flex h-full min-h-0 w-full flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl sm:max-w-[480px]"
        onKeyDown={e => {
          e.stopPropagation(); // typing R/F/? must never reach scene shortcuts
          if (e.defaultPrevented || (e.target as HTMLElement).closest('[role="dialog"]') !== e.currentTarget) return;
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          if (e.key !== 'Tab') return;
          const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',
          )).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
          const first = controls[0], last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <AliasAvatar alias={alias} size={28} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{alias}</h2>
            <p className="text-[11px] text-[var(--fg-muted)]">页内对话 · 关闭后回到当前视角</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭对话"
            className="min-h-11 min-w-11 rounded-lg hover:bg-[var(--hover-tint)]" data-testid="legion-chat-close">✕</button>
        </header>
        <div className="min-h-0 flex-1">
          <TaskChatPanel alias={alias} onClose={onClose} inline availableNodes={availableNodes} scopeNetworkId={networkId} />
        </div>
      </div>
    </div>
  );
}
