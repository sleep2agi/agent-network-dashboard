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
      className={`inline-flex h-6 max-w-full items-center rounded-md bg-[var(--bg-elevated)] px-2 font-medium text-[var(--fg-muted)] ${
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

const STATUS_TONE: Record<string, 'running' | 'online' | 'idle' | 'offline' | 'failed' | 'blocked'> = {
  working: 'running',
  running: 'running',
  active: 'online',
  published: 'online',
  done: 'online',
  online: 'online',
  idle: 'idle',
  offline: 'offline',
  paused: 'blocked',
  pending: 'blocked',
  failed: 'failed',
  error: 'failed',
  rejected: 'failed',
  blocked: 'blocked',
  cancelled: 'offline',
  completed: 'online',
  expired: 'offline',
  closed: 'offline',
};

const STATUS_TONE_CLASS = {
  running: 'bg-[var(--pill-running-bg)] text-[var(--pill-running-fg)]',
  online: 'bg-[var(--pill-online-bg)] text-[var(--pill-online-fg)]',
  idle: 'bg-[var(--pill-idle-bg)] text-[var(--pill-idle-fg)]',
  offline: 'bg-[var(--pill-offline-bg)] text-[var(--pill-offline-fg)]',
  failed: 'bg-[var(--pill-failed-bg)] text-[var(--pill-failed-fg)]',
  blocked: 'bg-[var(--pill-blocked-bg)] text-[var(--pill-blocked-fg)]',
} as const;

/** Same status capsule on home cards, the node list, and task rows. */
export function StatusPill({
  status,
  label,
  className = '',
  ...rest
}: { status: string; label?: string; className?: string } & HTMLAttributes<HTMLSpanElement>) {
  const tone = STATUS_TONE[status] || 'offline';
  const text = label || status;
  return (
    <span
      {...rest}
      title={text}
      className={`inline-flex h-5 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium leading-none ${STATUS_TONE_CLASS[tone]} ${className}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** Title, one-line description, and the page's primary action. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-[22px] font-semibold leading-7 tracking-tight text-[var(--fg)]" title={title}>{title}</h1>
          {meta}
        </div>
        {description ? (
          <p className="line-clamp-2 max-w-2xl text-[13px] leading-6 text-[var(--fg-muted)]" title={description}>{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export const fieldLabelClass = 'flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-[var(--fg-muted)]';
export const fieldControlClass = 'h-10 w-full rounded-[10px] bg-[var(--col-inset)] px-3 text-sm text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] placeholder:text-[var(--fg-dim)] focus:outline-none focus:shadow-[var(--focus-ring)]';
export const primaryButtonClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--accent)] px-3.5 text-[13px] font-medium text-[var(--accent-fg)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
export const quietButtonClass = 'inline-flex h-9 items-center rounded-[10px] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-40';

export function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`${fieldLabelClass} ${className}`}>
      <span className="truncate" title={label}>{label}</span>
      {children}
      {hint ? <span className="text-[11px] font-normal leading-5 text-[var(--fg-dim)]">{hint}</span> : null}
    </label>
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
    <div data-segmented aria-label={label} className="flex h-9 max-w-full items-center gap-0.5 overflow-x-auto rounded-[10px] bg-[var(--bg-secondary)] p-0.5 shadow-[var(--ds-shadow-card)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={`h-8 shrink-0 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
              active
                ? 'bg-[var(--accent-tonal)] text-[var(--accent)]'
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
