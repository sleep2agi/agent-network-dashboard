'use client';

/**
 * CollapsibleSearch
 * ──────────────────
 * #209 R34 — Reusable WeChat-style search-toggle pattern.
 *
 * Two pieces of UI from one component:
 *   1. A magnifier button (`w-9 h-9 rounded-full`) that lives in a page
 *      header — render it via `Button`.
 *   2. A collapsible search row that reveals below the header on open —
 *      render it via `Row`.
 *
 * Used together they replicate WeChat's chat-list search affordance:
 * the search field is hidden by default behind a small circle at the
 * top-right of the page header. Tapping it slides the input open,
 * autofocuses, and lets Escape clear + close. A cyan dot appears in
 * the corner of the icon when there is an active search term but the
 * row is collapsed, so the user always knows a filter is in effect.
 *
 * Owner of the search string is the parent (this component is
 * uncontrolled w.r.t. value — pure UI). That keeps the filter logic
 * with the page so it's easy to plumb additional behaviour like
 * `from:alias` shortcuts or highlight rendering.
 *
 * Shipped as a single component with two named children so callers
 * can place `<Button>` inside their existing header flex row and
 * `<Row>` just after, without restructuring around a tighter API.
 *
 * First adopters: /nodes (R32), /messages (R33). R34 ships
 * /nodes + /messages migrated to use this component; future pages
 * can add search by importing it instead of copy-pasting the JSX.
 */

import { useState, useCallback } from 'react';

interface CollapsibleSearchAPI {
  /** Round magnifier button. Place in your page header (e.g. right edge). */
  Button: () => React.JSX.Element;
  /** Collapsible search input row. Place immediately after the header. */
  Row: () => React.JSX.Element | null;
  /** Current search value — pass to your filter logic. */
  value: string;
  /** Programmatically clear + close (useful for "no results" reset link). */
  reset: () => void;
}

interface UseCollapsibleSearchProps {
  /** Controlled value + setter from the parent — owns the search string. */
  value: string;
  onChange: (next: string) => void;
  /** Input placeholder. */
  placeholder?: string;
  /** Accessible label for the button (also drives `title=`). */
  label?: string;
  /** Hide everything when false (e.g. when there is nothing to search). */
  enabled?: boolean;
}

export function useCollapsibleSearch({
  value,
  onChange,
  placeholder = 'Search…',
  label = 'Search',
  enabled = true,
}: UseCollapsibleSearchProps): CollapsibleSearchAPI {
  const [open, setOpen] = useState(false);

  const reset = useCallback(() => {
    onChange('');
    setOpen(false);
  }, [onChange]);

  const Button = useCallback(() => {
    if (!enabled) return <></>;
    const active = open || value;
    return (
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={open ? `Close ${label.toLowerCase()}` : `Open ${label.toLowerCase()}`}
        aria-pressed={open}
        title={open ? `Close ${label.toLowerCase()}` : label}
        className={`relative shrink-0 inline-flex items-center justify-center rounded-full border w-9 h-9 transition-colors ${
          active
            ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
            : 'border-[#2a2a4a] bg-[#111128] text-gray-400 hover:text-gray-200 hover:border-[#3a3a5a]'
        }`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {value && !open && (
          <span aria-hidden className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-[#0a0a1a]" />
        )}
      </button>
    );
  }, [open, value, label, enabled]);

  const Row = useCallback(() => {
    if (!enabled) return null;
    if (!open && !value) return null;
    return (
      <div className="mb-3 sm:mb-4 flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') reset(); }}
          placeholder={placeholder}
          autoFocus={open}
          className="flex-1 bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-base sm:text-sm text-white placeholder-gray-600 focus:border-cyan-500/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={reset}
          className="shrink-0 text-xs text-gray-500 hover:text-gray-300 px-2 py-2"
          aria-label="Clear and close search"
        >
          Cancel
        </button>
      </div>
    );
  }, [open, value, onChange, placeholder, reset, enabled]);

  return { Button, Row, value, reset };
}
