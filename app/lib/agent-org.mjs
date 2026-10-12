// Read-only Agent organization tree. Departments come from the Hub;
// agents hang off the person who owns them. A demo move only changes
// the in-memory department and never calls the network.

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function agentOf(value) {
  if (!value || typeof value !== 'object') return null;
  const row = value;
  if (typeof row.node_id !== 'string' || !row.node_id.trim()) return null;
  const alias = typeof row.alias === 'string' && row.alias.trim() ? row.alias.trim() : row.node_id.trim();
  return { nodeId: row.node_id.trim(), alias };
}

function agentsOf(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const agent = agentOf(item);
    if (!agent || seen.has(agent.nodeId)) continue;
    seen.add(agent.nodeId);
    out.push(agent);
  }
  return out;
}

function personOf(value) {
  if (!value || typeof value !== 'object') return null;
  const row = value;
  if (typeof row.user_id !== 'string' || !row.user_id.trim()) return null;
  if (typeof row.username !== 'string' || !row.username.trim()) return null;
  let departmentId = null;
  let departmentName = null;
  if (row.department && typeof row.department === 'object') {
    const dept = row.department;
    if (typeof dept.id === 'string' && dept.id.trim() && typeof dept.name === 'string' && dept.name.trim()) {
      departmentId = dept.id.trim();
      departmentName = dept.name.trim();
    }
  }
  return {
    userId: row.user_id.trim(),
    username: row.username.trim(),
    displayName: typeof row.display_name === 'string' ? row.display_name : '',
    departmentId,
    departmentName,
    agents: agentsOf(row.agents),
  };
}

export function parseDirectoryPage(json) {
  if (!json || typeof json !== 'object') return { people: [], unowned: [], hasMore: false, nextOffset: null };
  const row = json;
  const people = Array.isArray(row.people)
    ? row.people.flatMap((item) => {
      const person = personOf(item);
      return person ? [person] : [];
    })
    : [];
  return {
    people,
    unowned: agentsOf(row.agents_without_owner),
    hasMore: row.has_more === true,
    nextOffset: typeof row.next_offset === 'number' && Number.isFinite(row.next_offset) ? row.next_offset : null,
  };
}

export function normalizeDepartment(row) {
  if (!row || typeof row !== 'object') return null;
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  const parent = text(row.parent_id) || text(row.parentId);
  const leader = text(row.leader_user_id) || text(row.leaderUserId);
  const sort = typeof row.sort === 'number' && Number.isFinite(row.sort) ? row.sort : 0;
  const memberCount = typeof row.member_count === 'number' && Number.isFinite(row.member_count) ? row.member_count : 0;
  return { id, name, parent_id: parent || null, leader_user_id: leader || null, sort, member_count: memberCount };
}

const bySort = (a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id);

export function childrenOf(departments, parent) {
  return departments.filter((dept) => (dept.parent_id ?? null) === parent).sort(bySort);
}

export function flattenTree(departments, collapsed) {
  const out = [];
  const walk = (parent, depth, seen) => {
    for (const dept of childrenOf(departments, parent)) {
      if (seen.has(dept.id)) continue;
      seen.add(dept.id);
      const kids = childrenOf(departments, dept.id);
      out.push({ dept, depth, hasChildren: kids.length > 0 });
      if (!collapsed?.has(dept.id)) walk(dept.id, depth + 1, seen);
    }
  };
  walk(null, 0, new Set());
  return out;
}

export function subtreeIds(departments, dept) {
  const out = new Set([dept]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of departments) {
      if (row.parent_id && out.has(row.parent_id) && !out.has(row.id)) {
        out.add(row.id);
        grew = true;
      }
    }
  }
  return out;
}

export function ownerLabel(owner) {
  const display = text(owner?.displayName);
  return display || text(owner?.username);
}

function knownDepartment(data, id) {
  return !!id && data.departments.some((dept) => dept.id === id);
}

export function placeAgents(data, moves = []) {
  const byNode = new Map();
  const add = (agent, owner) => {
    const nodeId = text(agent?.nodeId);
    if (!nodeId || byNode.has(nodeId)) return;
    const source = owner && knownDepartment(data, owner.departmentId) ? owner.departmentId : null;
    byNode.set(nodeId, {
      nodeId,
      alias: text(agent.alias) || nodeId,
      ownerUserId: owner?.userId ?? null,
      ownerName: owner ? ownerLabel(owner) : null,
      sourceDepartmentId: source,
      departmentId: source,
      demo: false,
    });
  };
  for (const owner of data.owners || []) for (const agent of owner.agents || []) add(agent, owner);
  for (const agent of data.unowned || []) add(agent, null);
  for (const move of moves) {
    const row = byNode.get(move.nodeId);
    if (!row) continue;
    const next = knownDepartment(data, move.departmentId) ? move.departmentId : null;
    row.departmentId = next;
    row.demo = next !== row.sourceDepartmentId;
  }
  return [...byNode.values()].sort((a, b) => a.alias.localeCompare(b.alias, 'zh') || a.nodeId.localeCompare(b.nodeId));
}

export function agentsDirectlyIn(placed, dept) {
  return placed.filter((agent) => agent.departmentId === dept);
}

export function agentCount(placed, departments, dept) {
  if (dept === null) return placed.filter((agent) => agent.departmentId === null).length;
  const ids = subtreeIds(departments, dept);
  return placed.filter((agent) => agent.departmentId !== null && ids.has(agent.departmentId)).length;
}

function flatDepartments(names, owners) {
  return [...names.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'zh') || a[0].localeCompare(b[0]))
    .map(([id, name], sort) => ({
      id,
      name,
      parent_id: null,
      leader_user_id: null,
      sort,
      member_count: owners.filter((owner) => owner.departmentId === id).length,
    }));
}

function readDirectory(pages) {
  const owners = new Map();
  const names = new Map();
  let unowned = [];
  for (const [index, page] of pages.entries()) {
    const parsed = parseDirectoryPage(page);
    if (index === 0) unowned = parsed.unowned;
    for (const person of parsed.people) {
      if (person.departmentId && person.departmentName && !names.has(person.departmentId)) names.set(person.departmentId, person.departmentName);
      if (!owners.has(person.userId)) owners.set(person.userId, person);
    }
  }
  return { owners: [...owners.values()], unowned, names };
}

const missingStatus = (status) => status === 404 || status === 405;

/**
 * status ready | missing | error.
 * missing means both the department API and the people directory are absent.
 */
export function buildAgentOrg({ departmentsStatus, departmentsBody, directoryStatus, directoryPages }) {
  const departmentsMissing = missingStatus(departmentsStatus);
  const directoryMissing = missingStatus(directoryStatus);
  if (!departmentsMissing && (departmentsStatus < 200 || departmentsStatus >= 300 || departmentsBody?.ok === false)) {
    return { status: 'error', error: text(departmentsBody?.error) || `departments HTTP ${departmentsStatus}` };
  }
  if (!directoryMissing && (directoryStatus < 200 || directoryStatus >= 300)) {
    return { status: 'error', error: `directory HTTP ${directoryStatus}` };
  }
  if (departmentsMissing && directoryMissing) return { status: 'missing' };
  const directory = directoryMissing ? { owners: [], unowned: [], names: new Map() } : readDirectory(directoryPages || []);
  const fromApi = departmentsMissing
    ? []
    : (Array.isArray(departmentsBody?.departments) ? departmentsBody.departments : []).map(normalizeDepartment).filter(Boolean);
  const departments = departmentsMissing ? flatDepartments(directory.names, directory.owners) : fromApi;
  return {
    status: 'ready',
    data: {
      departments,
      owners: directory.owners,
      unowned: directory.unowned,
      directory: !directoryMissing,
      departmentsApi: !departmentsMissing,
    },
  };
}

/** Local-only structure move. A passed network function is never called. */
export function simulateStructureMove(input, net) {
  if (typeof net === 'function') void net;
  const nodeId = text(input?.nodeId);
  if (!nodeId) return { ok: false, reason: 'node', network: false, persisted: false };
  if (input?.departmentId === null) return { ok: true, network: false, persisted: false, nodeId, departmentId: null };
  const departmentId = text(input?.departmentId);
  if (!departmentId) return { ok: false, reason: 'department', network: false, persisted: false };
  return { ok: true, network: false, persisted: false, nodeId, departmentId };
}
