'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AliasAvatar } from './AliasAvatar';
import { TaskChatPanel } from './TaskChatPanel';

interface ChatPopoverProps {
  /** Node alias to chat with. Changing it switches the conversation. */
  alias: string;
  onClose: () => void;
}

const MAX_W = 380;
const MAX_H = 520;
const MIN_W = 300;
const MIN_H = 320;
const MARGIN = 16;
const MOBILE_BP = 640;

/**
 * Issue #100: a floating, draggable chat window opened by clicking a node
 * avatar in the topology graph. Singleton — the parent (TopoGraph) keeps a
 * single `chatAlias`, so clicking another node just swaps `alias` here and
 * the conversation switches in place.
 *
 * Issue #106: a bottom-right handle resizes the window (drag to change w/h,
 * clamped to MIN_W/MIN_H .. the viewport). Coexists with the header move-drag
 * and the close button — each interaction lives on a distinct element and
 * stops its own pointerdown from reaching the others.
 *
 * One consistent design across viewports: a floating draggable card sized to
 * fit (`min(380, vw-32) × min(520, vh-96)`). On a phone it ends up near
 * full-width, so it's docked low on open — the graph above stays visible, and
 * to chat with a different node you drag it down / tap an exposed avatar.
 *
 * The chat body reuses TaskChatPanel's `inline` mode — send / SSE-receive /
 * history are already solved there; this component only adds the floating
 * shell + drag/resize behaviour.
 */
export function ChatPopover({ alias, onClose }: ChatPopoverProps) {
  // Position + size are resolved on mount (SSR-safe defaults here).
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: MAX_W, h: MAX_H });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false, startX: 0, startY: 0, baseX: 0, baseY: 0,
  });
  const resizeRef = useRef<{ active: boolean; startX: number; startY: number; baseW: number; baseH: number }>({
    active: false, startX: 0, startY: 0, baseW: 0, baseH: 0,
  });

  const clamp = useCallback((x: number, y: number, w: number, h: number) => {
    const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    return {
      x: Math.min(Math.max(MARGIN, x), maxX),
      y: Math.min(Math.max(MARGIN, y), maxY),
    };
  }, []);

  useEffect(() => {
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(MAX_W, vw - MARGIN * 2);
      const h = Math.min(MAX_H, vh - MARGIN * 6);
      setSize({ w, h });
      const mobile = vw < MOBILE_BP;
      // Desktop: top-right of the graph. Mobile: docked low so the graph
      // above stays visible — switch nodes by tapping an exposed avatar.
      const x = mobile ? MARGIN : vw - w - 24;
      const y = mobile ? vh - h - MARGIN : 96;
      setPos(clamp(x, y, w, h));
    };
    place();
    // Keep the popover on-screen if the window is resized.
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [clamp]);

  // Esc closes — matches the rest of the dashboard's overlay convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    setPos(clamp(d.baseX + (e.clientX - d.startX), d.baseY + (e.clientY - d.startY), size.w, size.h));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
  };

  // Resize from the bottom-right handle. stopPropagation keeps the header
  // move-drag out of it; the popover is top-left anchored so growing it can
  // only push the bottom/right edges, which we clamp to the viewport.
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    resizeRef.current = { active: true, startX: e.clientX, startY: e.clientY, baseW: size.w, baseH: size.h };
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r.active) return;
    e.stopPropagation();
    const maxW = Math.max(MIN_W, window.innerWidth - pos.x - MARGIN);
    const maxH = Math.max(MIN_H, window.innerHeight - pos.y - MARGIN);
    setSize({
      w: Math.min(maxW, Math.max(MIN_W, r.baseW + (e.clientX - r.startX))),
      h: Math.min(maxH, Math.max(MIN_H, r.baseH + (e.clientY - r.startY))),
    });
  };
  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current.active) return;
    resizeRef.current.active = false;
    e.stopPropagation();
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
  };

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-[#2a2a4a] bg-[#0a0a1a] shadow-2xl shadow-black/60 anet-fade-in"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      role="dialog"
      aria-label={`Chat with ${alias}`}
    >
      {/* Drag handle — the whole header bar moves the window. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex items-center justify-between px-3 py-2.5 border-b border-[#2a2a4a] bg-[#0d0d1a] rounded-t-xl cursor-grab active:cursor-grabbing select-none touch-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <AliasAvatar alias={alias} size={28} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{alias}</div>
            <div className="text-[10px] text-gray-500">Drag to move · Esc to close</div>
          </div>
        </div>
        <button
          onClick={onClose}
          // Without this the header's drag handler captures the pointer and
          // Chromium retargets the click to the header — the button never fires.
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Close chat"
          className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-[#1a1a2a] shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Chat body — TaskChatPanel inline mode owns send / SSE / history. */}
      <div className="flex-1 min-h-0">
        <TaskChatPanel alias={alias} onClose={onClose} inline />
      </div>

      {/* Issue #106: bottom-right resize handle. */}
      <div
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        aria-label="Resize chat"
        className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize touch-none z-10"
        style={{ touchAction: 'none' }}
      >
        <svg className="absolute bottom-0.5 right-0.5 w-3 h-3 text-gray-600" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <path d="M11 5L5 11M11 9L9 11" />
        </svg>
      </div>
    </div>
  );
}
