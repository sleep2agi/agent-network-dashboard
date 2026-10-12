import assert from 'node:assert/strict';
import {
  agentCount,
  agentsDirectlyIn,
  buildAgentOrg,
  flattenTree,
  parseDirectoryPage,
  placeAgents,
  simulateStructureMove,
} from './agent-org.mjs';

const dept = (id, name, parent, sort = 0) => ({ id, name, parent_id: parent, leader_user_id: null, sort, member_count: 0 });
const data = {
  departments: [dept('rd', '产品研发部', null, 0), dept('fe', '前端组', 'rd', 0), dept('be', '后端组', 'rd', 1), dept('ops', '运营部', null, 1)],
  owners: [{
    userId: 'u1',
    username: 'ada',
    displayName: 'Ada',
    departmentId: 'fe',
    agents: [{ nodeId: 'n1', alias: '甲' }, { nodeId: 'n1', alias: '重复' }],
  }],
  unowned: [{ nodeId: 'n2', alias: '乙' }, { nodeId: 'n1', alias: '不该覆盖' }],
  directory: true,
  departmentsApi: true,
};

const rows = flattenTree(data.departments);
assert.deepEqual(rows.map((row) => [row.dept.id, row.depth]), [['rd', 0], ['fe', 1], ['be', 1], ['ops', 0]]);
assert.deepEqual(flattenTree(data.departments, new Set(['rd'])).map((row) => row.dept.id), ['rd', 'ops']);

const placed = placeAgents(data);
assert.equal(placed.length, 2);
assert.equal(placed.find((agent) => agent.nodeId === 'n1').alias, '甲');
assert.equal(placed.find((agent) => agent.nodeId === 'n1').departmentId, 'fe');
assert.equal(agentsDirectlyIn(placed, 'fe').length, 1);
assert.equal(agentCount(placed, data.departments, 'rd'), 1);
assert.equal(agentCount(placed, data.departments, 'fe'), 1);
assert.equal(agentCount(placed, data.departments, null), 1);

const moved = placeAgents(data, [{ nodeId: 'n1', departmentId: 'ops' }]);
assert.equal(moved.find((agent) => agent.nodeId === 'n1').departmentId, 'ops');
assert.equal(moved.find((agent) => agent.nodeId === 'n1').demo, true);
assert.equal(moved.find((agent) => agent.nodeId === 'n1').ownerName, 'Ada');
assert.equal(agentCount(moved, data.departments, 'rd'), 0);
assert.equal(placeAgents(data, [{ nodeId: 'n1', departmentId: 'missing' }]).find((agent) => agent.nodeId === 'n1').departmentId, null);

const page = parseDirectoryPage({
  people: [
    { user_id: 'u1', username: 'ada', display_name: 'Ada', department: { id: 'fe', name: '前端组' }, agents: [{ node_id: 'n1', alias: '甲' }] },
    { username: 'drop-me' },
  ],
  agents_without_owner: [{ node_id: 'n2' }, { nope: true }],
  has_more: true,
  next_offset: 200,
});
assert.equal(page.people.length, 1);
assert.equal(page.people[0].departmentName, '前端组');
assert.equal(page.unowned[0].alias, 'n2');
assert.equal(page.hasMore, true);
assert.equal(page.nextOffset, 200);

assert.equal(buildAgentOrg({ departmentsStatus: 404, departmentsBody: null, directoryStatus: 405, directoryPages: [] }).status, 'missing');
const directoryPage = {
  people: [{ user_id: 'u1', username: 'ada', display_name: 'Ada', department: { id: 'fe', name: '前端组' }, agents: [{ node_id: 'n1', alias: '甲' }] }],
  agents_without_owner: [{ node_id: 'n2' }],
  has_more: false,
};
const flat = buildAgentOrg({
  departmentsStatus: 404,
  departmentsBody: null,
  directoryStatus: 200,
  directoryPages: [directoryPage],
});
assert.equal(flat.status, 'ready');
assert.equal(flat.data.departmentsApi, false);
assert.equal(flat.data.departments[0].name, '前端组');
assert.equal(flat.data.departments[0].parent_id, null);

const tree = buildAgentOrg({
  departmentsStatus: 200,
  departmentsBody: { ok: true, departments: [dept('rd', '产品研发部', null), { id: '', name: 'bad' }] },
  directoryStatus: 200,
  directoryPages: [directoryPage],
});
assert.equal(tree.data.departments.length, 1);
assert.equal(tree.data.departments[0].id, 'rd');
assert.equal(tree.data.owners[0].agents[0].alias, '甲');

assert.equal(buildAgentOrg({ departmentsStatus: 500, departmentsBody: { ok: false, error: 'boom' }, directoryStatus: 200, directoryPages: [] }).status, 'error');

let called = false;
const demo = simulateStructureMove({ nodeId: ' n1 ', departmentId: null }, () => { called = true; });
assert.equal(demo.ok, true);
assert.equal(demo.persisted, false);
assert.equal(demo.network, false);
assert.equal(called, false);
assert.equal(simulateStructureMove({ nodeId: '', departmentId: 'fe' }).ok, false);

console.log('agent org: PASS');
