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
check('all four schedule forms are presented', ['once', 'interval', 'daily', 'weekly'].every(x => page.includes(`value=\"${x}\"`)));
check('management actions exist', ['run-now', "method: 'PATCH'", "method: 'DELETE'", '/runs'].every(x => page.includes(x)));
check('optimistic revision is forwarded', page.includes('revision: row.revision'));
check('timezone is explicit', page.includes('resolvedOptions().timeZone') && page.includes('timezone, schedule'));
check('proxy requires dashboard auth', proxy.includes('requireDashboardAuth()') && proxy.includes('getV3UserToken()'));
check('proxy path is bounded and token is server-side', proxy.includes('path.length > 2') && proxy.includes('Authorization: `Bearer ${token}`'));
check('nodes proxy preserves network scope', nodesProxy.includes("['node_id', 'alias', 'network_id']"));
check('desktop and mobile expose module', sidebar.includes("href: '/scheduled-tasks'") && mobile.includes("href: '/scheduled-tasks'"));

console.log(`dashboard scheduled tasks: ${passed} checks passed`);
