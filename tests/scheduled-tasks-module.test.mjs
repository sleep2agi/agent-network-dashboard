import { readFileSync } from 'node:fs';

let passed = 0;
function check(label, condition) {
  if (!condition) { console.error(`FAIL: ${label}`); process.exit(1); }
  passed++; console.log(`PASS: ${label}`);
}

const page = readFileSync('app/scheduled-tasks/page.tsx', 'utf8');
const proxy = readFileSync('app/api/hub/scheduled-tasks/[[...path]]/route.ts', 'utf8');
const nodesProxy = readFileSync('app/api/hub/nodes/route.ts', 'utf8');
const sidebar = readFileSync('app/components/Sidebar.tsx', 'utf8');
const mobile = readFileSync('app/components/MobileNav.tsx', 'utf8');

check('page lists schedules through dashboard proxy', page.includes("fetch(`/api/hub/scheduled-tasks${query}`"));
check('page loads stable node inventory', page.includes("fetch(`/api/hub/nodes${query}`") && page.includes('target_node_id: targetNodeId'));
check('creation requires one selected network and node load cannot fail silently', page.includes("setError('请先在左侧选择一个网络')") && page.includes('if (!nodeRes.ok)'));
check('all four schedule forms are presented', ['once', 'interval', 'daily', 'weekly'].every(x => page.includes(`value=\"${x}\"`)));
check('management actions exist', ['run-now', "method: 'PATCH'", '/runs'].every(x => page.includes(x)));
// Cancel goes through POST /cancel, not DELETE. Some reverse proxies swallow
// DELETE and return 405 HTML which broke `await res.json()` with "Unexpected
// token <". The change is two-part: the URL must include `/cancel` and the
// mutate call must build a POST init for the cancel branch.
check('cancel uses POST /cancel path (not DELETE)',
  page.includes("/cancel${query}") &&
  page.includes("action === 'cancel'") &&
  !page.includes("action === 'cancel') init = { method: 'DELETE' }"));
// Response body is parsed as text first so an empty body or an HTML error
// page from a misbehaving proxy doesn't throw before the status is checked.
check('mutate reads response as text before JSON.parse',
  page.includes('await res.text()') && page.includes('JSON.parse(raw)'));
// Cancel action requires explicit user confirmation (terminal state; cannot
// be resurrected via PATCH — the server rejects with 409 schedule_cancelled).
check('cancel prompts for confirmation before firing',
  page.includes("action === 'cancel'") && page.includes("window.confirm('确定取消这个定时计划？取消后不能恢复。')"));
// Cancelled schedules are hidden by default so the list represents "what's on
// the calendar going forward", not the full audit trail.
check('cancelled schedules are filtered from the default list',
  page.includes("schedules.filter(row => row.status !== 'cancelled')"));
// Every action button on a schedule row has an explicit type="button". A
// missing type="button" inside a rendered <form>-like context is what turned
// "取消" into a form submit in the field report. All five row actions plus
// the top "新建计划" button must carry it.
check('all row action buttons have explicit type="button"',
  ['openEdit(row)', "mutate(row, 'toggle')", "mutate(row, 'run')", 'openHistory(row)', "mutate(row, 'cancel')"].every(handler => {
    const idx = page.indexOf(handler);
    if (idx < 0) return false;
    // walk backwards from the handler to find the enclosing <button ...>
    const openTag = page.lastIndexOf('<button', idx);
    if (openTag < 0) return false;
    return page.slice(openTag, idx).includes('type="button"');
  }));
check('optimistic revision is forwarded', page.includes('revision: row.revision'));
check('active and paused schedules expose a full edit action while terminal schedules stay disabled',
  page.includes("onClick={() => openEdit(row)}") && page.includes("!['active','paused'].includes(row.status)"));
check('edit form restores every mutable field without losing interval precision',
  ['setName(row.name)', 'setTargetNodeId(row.target_node_id)', 'setTask(row.task_content)',
    'setPriority(row.priority)', 'setTimezone(row.timezone)', 'setMisfirePolicy', 'intervalFormValue'].every(x => page.includes(x)) &&
  page.includes('<option value="seconds">'));
check('edit PATCH carries exact revision and the complete mutable payload',
  page.includes("method: editing ? 'PATCH' : 'POST'") &&
  page.includes('...(editing ? { revision: editing.revision }') &&
  ['name, target_node_id: targetNodeId, task, priority, timezone', 'misfire_policy: misfirePolicy', 'schedule: makeSchedule()'].every(x => page.includes(x)));
check('revision conflict closes stale form, reloads authoritative data, and tells the user',
  page.includes("res.status === 409 && data.error === 'revision_conflict'") &&
  page.includes('await load()') && page.includes('已刷新最新内容，请重新编辑'));
check('timezone is explicit', page.includes('resolvedOptions().timeZone') && page.includes('timezone') && page.includes('schedule: makeSchedule()'));
check('creation exposes both misfire policies and sends the selected value',
  page.includes('catch_up_once') && page.includes('value="skip"') && page.includes('misfire_policy: misfirePolicy'));
check('schedule cards disclose the effective misfire policy',
  page.includes('错过后补跑一次') && page.includes('错过后跳过'));
check('proxy requires dashboard auth', proxy.includes('requireDashboardAuth()') && proxy.includes('getV3UserToken()'));
check('proxy path is bounded and token is server-side', proxy.includes('path.length > 2') && proxy.includes('Authorization: `Bearer ${token}`'));
check('nodes proxy preserves network scope', nodesProxy.includes("['node_id', 'alias', 'network_id']"));
check('legacy sessions fallback remains network scoped', nodesProxy.includes('statusUrl') && nodesProxy.includes('s.network_id === requestedNetworkId'));
check('desktop and mobile expose module', sidebar.includes("href: '/scheduled-tasks'") && mobile.includes("href: '/scheduled-tasks'"));

console.log(`dashboard scheduled tasks: ${passed} checks passed`);
