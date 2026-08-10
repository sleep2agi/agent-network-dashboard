import { readFileSync } from 'node:fs';

const page = readFileSync('app/node/page.tsx', 'utf8');
const route = readFileSync('app/api/hub/nodes/[ref]/external-schedule-edits/route.ts', 'utf8');
const checks = [
  ['owner proxy requires dashboard auth', route.includes('requireDashboardAuth()')],
  ['owner proxy requires utok without admin/ntok upgrade', route.includes("token?.startsWith('utok_')") && route.includes('user_token_required')],
  ['proxy forwards token only in Authorization header', route.includes('Authorization: `Bearer ${token}`') && !route.includes('?token=')],
  ['proxy path is exact node edit endpoint', route.includes('/external-schedule-edits') && route.includes('encodeURIComponent(nodeId)')],
  ['proxy refuses unknown body and nested patch keys', route.includes('BODY_KEYS') && route.includes('PATCH_KEYS') && route.includes('invalid_edit_request')],
  ['UI requires server-reported editable and integer revision', page.includes('schedule.editable === true') && page.includes('Number.isSafeInteger(schedule.revision)')],
  ['UI sends opaque structured fields without command', page.includes('schedule_id: editing.id') && page.includes('base_revision: editing.revision') && page.includes('patch: { cron: cron.trim(), enabled }')],
  ['UI discloses immutable command boundary', page.includes('The command is immutable.')],
];
for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`dashboard owner schedule contract: ${checks.length} checks passed`);
