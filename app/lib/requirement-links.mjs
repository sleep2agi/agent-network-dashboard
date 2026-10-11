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

function fold(value) {
  return text(value).normalize('NFKC').toLocaleLowerCase();
}

/** Tags the Hub will store: at most 10, each at most 20 characters, no controls. */
export function normalizeTags(value) {
  if (!Array.isArray(value) || value.length > 10) return [];
  const tags = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return [];
    const tag = raw.trim();
    if (!tag || [...tag].length > 20 || /[\u0000-\u001f\u007f]/u.test(tag)) return [];
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function personRef(value) {
  if (!value || typeof value !== 'object') return null;
  const kind = value.kind === 'node' || value.kind === 'user' ? value.kind : '';
  const id = text(value.id);
  if (!kind || !id) return null;
  return {
    kind,
    id,
    ...(text(value.display_name) ? { display_name: text(value.display_name) } : {}),
    ...(text(value.displayName) ? { displayName: text(value.displayName) } : {}),
    ...(text(value.name) ? { name: text(value.name) } : {}),
    ...(text(value.alias) ? { alias: text(value.alias) } : {}),
  };
}

function checklistOf(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.text !== 'string') continue;
    out.push({ id: row.id, text: row.text, done: row.done === true });
  }
  return out;
}

function issuesOf(value) {
  if (!Array.isArray(value) || value.length > 8) return [];
  const out = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const repo = text(row.repo);
    const number = typeof row.number === 'number' ? row.number : Number(row.number);
    if (!repo || !Number.isInteger(number) || number < 1) continue;
    out.push({ repo, number, title: text(row.title) });
  }
  return out;
}

/**
 * One Hub requirement row, accepting the snake_case payload and the
 * camelCase shape already used in the dashboard. Missing fields stay empty
 * so an older Hub still renders.
 */
export function normalizeRequirement(row) {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim()) return null;
  const due = text(row.due);
  const start = text(row.start);
  const projectId = text(row.projectId) || text(row.project_id);
  const owner = personRef(row.owner);
  const agent = personRef(row.agentOwner) || personRef(row.agent_owner);
  const external = text(row.externalUrl) || text(row.external_url);
  const safeExternal = /^https?:\/\//i.test(external) ? external : '';
  const updated = text(row.updatedAt) || text(row.updated_at);
  const children = row.children && typeof row.children === 'object'
    ? { total: num(row.children.total), done: num(row.children.done) }
    : null;
  return {
    id: row.id.trim(),
    name: typeof row.name === 'string' ? row.name : '',
    seq: typeof row.seq === 'number' && Number.isSafeInteger(row.seq) && row.seq > 0 ? row.seq : null,
    column: text(row.column) || 'pool',
    priority: text(row.priority) || 'normal',
    due,
    start,
    assignee: text(row.assignee),
    tags: normalizeTags(row.tags),
    owner,
    agent_owner: agent,
    agentOwner: agent,
    participants: Array.isArray(row.participants) ? row.participants.map(personRef).filter(Boolean) : [],
    projectId,
    project_id: projectId,
    description: typeof row.description === 'string' ? row.description : '',
    archived: row.archived === true,
    checklist: checklistOf(row.checklist),
    issues: issuesOf(row.issues),
    parentId: text(row.parentId) || text(row.parent_id),
    children,
    external_url: safeExternal,
    externalUrl: safeExternal,
    updatedAt: updated,
    createdAt: text(row.createdAt) || text(row.created_at),
  };
}

/** End of a date-only due, or the instant of a timestamp. Null when unset. */
export function requirementDueMs(due) {
  const value = text(due);
  if (!value) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    const end = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 23, 59, 59, 999);
    return Number.isNaN(end.getTime()) ? null : end.getTime();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Open tasks whose due instant is already past. Done and abandoned are closed. */
export function isRequirementOverdue(item, now = Date.now()) {
  if (!item || item.archived || item.column === 'done' || item.column === 'abandoned') return false;
  const due = requirementDueMs(item.due);
  return due !== null && due < now;
}

/** overdue | today | later | none — the schedule buckets the client calendar uses. */
export function scheduleBucket(item, now = Date.now()) {
  const due = requirementDueMs(item?.due);
  if (due === null) return 'none';
  if (isRequirementOverdue(item, now)) return 'overdue';
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  if (due < next.getTime()) return 'today';
  return 'later';
}

const PRIORITY_RANK = { high: 0, normal: 1, low: 2, lowest: 3 };

/** Client column order: priority, then due, then newer cards first. */
export function compareRequirements(a, b) {
  const byPriority = (PRIORITY_RANK[a?.priority] ?? 1) - (PRIORITY_RANK[b?.priority] ?? 1);
  if (byPriority) return byPriority;
  const ad = requirementDueMs(a?.due) ?? Number.POSITIVE_INFINITY;
  const bd = requirementDueMs(b?.due) ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad < bd ? -1 : 1;
  const ac = a?.createdAt || '';
  const bc = b?.createdAt || '';
  if (ac === bc) return 0;
  return ac < bc ? 1 : -1;
}

/**
 * Local filter used while a Hub search request is in flight.
 * Empty query matches everything. Several words are AND across title,
 * description, tags, assignee, people, and project name. A bare #id or
 * id prefix still matches on its own.
 */
export function matchesRequirementQuery(item, query) {
  const raw = text(query);
  if (!raw) return true;
  const folded = fold(raw);
  const seqHit = /^#?(\d{1,15})$/.exec(folded);
  if (seqHit && typeof item?.seq === 'number' && item.seq === Number(seqHit[1])) return true;
  const id = fold(item?.id);
  const bare = folded.replace(/^#/, '').replace(/^req_/, '');
  if (id && (id === folded || id === bare || (bare.length >= 8 && id.replace(/^req_/, '').startsWith(bare)))) return true;
  const terms = [...new Set(folded.split(/\s+/).filter(Boolean))];
  if (!terms.length) return true;
  const people = [
    item?.owner,
    item?.agentOwner,
    item?.agent_owner,
    ...(Array.isArray(item?.participants) ? item.participants : []),
  ].filter(Boolean);
  const hay = fold([
    item?.name,
    item?.description,
    item?.assignee,
    item?.projectName,
    ...(Array.isArray(item?.tags) ? item.tags : []),
    ...people.map((person) => [person.display_name, person.displayName, person.name, person.alias].filter(Boolean).join(' ')),
  ].filter((part) => typeof part === 'string' && part).join('\n'));
  return terms.every((term) => hay.includes(term));
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
