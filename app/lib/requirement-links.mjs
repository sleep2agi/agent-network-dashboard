// Requirement (Hub task) deep links and display names.
// The dashboard detail route is /board/<requirement id>. Short ids (#918)
// are labels on that link, not a second destination.

const TOKEN_ID = /^token:/i;

export function shortIdLabel(seq) {
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0 ? `#${seq}` : null;
}

/** Canonical dashboard route for one Hub requirement. Null when there is no id. */
export function requirementDetailPath(id) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return `/board/${encodeURIComponent(trimmed)}`;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function named(value) {
  const label = text(value);
  return label && !TOKEN_ID.test(label) ? label : '';
}

/**
 * Leaderboard / activity name.
 * Prefer a display name the Hub (or the people directory) actually returned.
 * Never surface a raw `token:tok_…` id — unbound node tokens use that shape
 * and it is not a name.
 */
export function personLabel(ref, people) {
  if (!ref || typeof ref !== 'object') return 'Unknown';
  const kind = ref.kind === 'node' || ref.kind === 'user' ? ref.kind : '';
  const id = text(ref.id);
  const embedded = named(ref.display_name) || named(ref.displayName) || named(ref.name) || named(ref.alias);
  if (embedded) return embedded;
  const match = Array.isArray(people)
    ? people.find((person) => person && person.kind === kind && text(person.id) === id)
    : null;
  if (match) {
    const fromDir = named(match.display_name) || named(match.displayName) || named(match.name) || named(match.alias);
    if (fromDir) return fromDir;
  }
  if (kind === 'node' || TOKEN_ID.test(id)) return 'Agent';
  if (kind === 'user') return 'Member';
  return 'Unknown';
}

/** Local filter used while a Hub search request is in flight. Empty query matches everything. */
export function matchesRequirementQuery(item, query) {
  const q = text(query).toLowerCase();
  if (!q) return true;
  const seqHit = /^#?(\d{1,15})$/.exec(q);
  if (seqHit && typeof item?.seq === 'number') return item.seq === Number(seqHit[1]);
  const name = text(item?.name).toLowerCase();
  const id = text(item?.id).toLowerCase();
  if (name.includes(q) || id === q) return true;
  const bare = q.replace(/^req_/, '');
  return bare.length >= 8 && id.replace(/^req_/, '').startsWith(bare);
}

/** Monday-start period, local timezone. `all` has no lower bound. */
export function periodFromIso(period, now) {
  if (period === 'all') return null;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (period === 'month') d.setDate(1);
  else if (period !== 'today') return null;
  return d.toISOString();
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** The stats fields the dashboard widgets render. Null when the payload is not stats. */
export function readStats(raw) {
  if (!raw || typeof raw !== 'object' || !raw.totals || typeof raw.totals !== 'object') return null;
  const totals = raw.totals;
  return {
    done: num(totals.done),
    doing: num(totals.doing),
    pool: num(totals.pool),
    abandoned: num(totals.abandoned),
    leaders: Array.isArray(raw.by_completer) ? raw.by_completer.filter((row) => row && typeof row === 'object') : [],
    recent: Array.isArray(raw.recent) ? raw.recent.filter((row) => row && typeof row.id === 'string') : [],
    daily: Array.isArray(raw.daily) ? raw.daily.filter((row) => row && typeof row.date === 'string') : [],
  };
}
