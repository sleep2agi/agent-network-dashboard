import type { HTMLAttributes, ReactNode } from 'react';

/** Shared task-surface chrome so board, list, activity, and the leaderboard match. */

export function columnDot(column?: string): string {
  if (column === 'doing') return 'var(--info)';
  if (column === 'done') return 'var(--success)';
  if (column === 'abandoned' || column === 'pool') return 'var(--offline)';
  return 'var(--fg-dim)';
}

export function columnLabel(column?: string): string {
  if (column === 'doing') return 'In progress';
  if (column === 'done') return 'Done';
  if (column === 'abandoned') return 'Abandoned';
  if (column === 'pool') return 'Pool';
  return column || '—';
}

export function TaskPanel({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={`rounded-[10px] bg-[var(--bg-secondary)] p-4 shadow-[var(--ds-shadow-card)] ${className}`}
    >
      {children}
    </section>
  );
}

export function TaskCard({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-[10px] bg-[var(--bg-secondary)] p-3 shadow-[var(--ds-shadow-card)] transition-colors hover:bg-[var(--bg-elevated)] ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1.5 pb-2">
      <h2 className="text-[15px] font-semibold leading-[22px] text-[var(--fg)]">{title}</h2>
      {hint ? <span className="text-[11px] tabular-nums text-[var(--fg-dim)]">{hint}</span> : null}
    </div>
  );
}

export function MetaChip({ children, soft = false }: { children: ReactNode; soft?: boolean }) {
  return (
    <span
      className={`inline-flex h-5 max-w-full items-center rounded-md bg-[var(--bg-elevated)] px-1.5 font-medium text-[var(--fg-muted)] ${
        soft ? 'text-xs' : 'text-[11px]'
      }`}
    >
      {children}
    </span>
  );
}

export function TagList({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex h-5 max-w-[10rem] items-center truncate rounded-md bg-[var(--bg-elevated)] px-1.5 text-[11px] font-medium text-[var(--fg-muted)]">
          {tag}
        </span>
      ))}
    </span>
  );
}

export function PriorityChip({ priority }: { priority?: string }) {
  if (!priority || priority === 'normal') return null;
  const high = priority === 'high';
  const lowest = priority === 'lowest';
  const color = high ? 'var(--prio-high)' : lowest ? 'var(--prio-lowest)' : 'var(--prio-low)';
  const label = high ? '高' : lowest ? '最低' : '低';
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 text-[11px] font-medium"
      style={{ color: lowest ? 'var(--fg-dim)' : 'var(--fg-muted)' }}
      title={priority}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={high ? { background: color } : { boxShadow: `inset 0 0 0 1.5px ${color}` }}
      />
      {label}
    </span>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div aria-label={label} className="flex h-8 flex-wrap items-center gap-0.5 rounded-[10px] bg-[var(--bg-secondary)] p-0.5">
      {options.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={`h-7 rounded-md px-3 text-[13px] font-medium transition-colors ${
              active
                ? 'bg-[var(--bg-elevated)] text-[var(--fg)]'
                : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
