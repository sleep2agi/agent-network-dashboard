import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('app/api/anet/host-supervisors/route.ts', 'utf8');
const picker = readFileSync('app/components/HostSupervisorPicker.tsx', 'utf8');
const wizard = readFileSync('app/components/CreateNodeWizard.tsx', 'utf8');

const hostRow = route.match(/interface HostSupervisorRow \{[\s\S]*?\n\}/)?.[0] || '';
const serverRow = route.match(/interface ServerRow \{[\s\S]*?\n\}/)?.[0] || '';
const hostOption = picker.match(/interface HostOption \{[\s\S]*?\n\}/)?.[0] || '';

for (const block of [hostRow, serverRow, hostOption]) {
  assert.doesNotMatch(block, /\bip\b|cpu_|mem_|agent_count|\bnote\b/, 'server picker host projection must not expose /api/servers telemetry fields');
}

assert.match(route, /daemon: DaemonRow \| null/, 'host rows may carry only the list_host_supervisors daemon row');
assert.match(route, /has_daemon: boolean/, 'host rows must expose daemon availability for the no-daemon onboarding branch');
assert.match(route, /hostname: s\.hostname,[\s\S]*?status: s\.status,[\s\S]*?\}\)\);/, 'server source must be projected to hostname/status only before joining');
assert.doesNotMatch(route, /ip: s\.ip|cpu_load_1min: s\.cpu|mem_used_gb: s\.mem|agent_count: s\.agent|note: s\.note/, 'route must not merge raw /api/servers fields into hosts');

const handleCreate = wizard.match(/async function handleCreate\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
const guardPos = handleCreate.indexOf('if (!daemonNodeId)');
const fetchPos = handleCreate.indexOf("fetch('/api/anet/node-create'");
assert.ok(guardPos >= 0 && fetchPos > guardPos, 'wizard must reject empty daemon before POSTing create_node');
assert.match(handleCreate, /daemon_node_id: daemonNodeId/, 'wizard create path must explicitly send daemon_node_id');
assert.doesNotMatch(handleCreate, /\.\.\.\(daemonNodeId \? \{ daemon_node_id: daemonNodeId \} : \{\}\)/, 'wizard must not conditionally omit daemon_node_id');

console.log('RFC-026 P2 server picker contract: PASS');
