/* #157 RC#2 verification — Servers panel hostname dedup.
 *
 * Bug (Vincent 5560 + live re-probe 2026-05-20): the hub /api/servers
 * endpoint keys host telemetry by (hostname, ip), so a machine whose
 * agents report over more than one interface surfaces as multiple
 * rows. `iZrj93pr2rcf5r2y9uo1oyZ` appeared twice — Docker-bridge IP
 * (telemetry-bearing) + loopback (telemetry null) — splitting its
 * agent count across two cards.
 *
 * Fix: `dedupeByHostname` in app/lib/serverDedupe.ts, applied in the
 * /api/hub/servers proxy before normalizeServer.
 *
 * Two legs:
 *   A. mock fixture — compile serverDedupe.ts, run a crafted payload
 *      that exercises every branch (multi-row merge, telemetry
 *      coalesce, NAT-shared IP NOT merged, `unknown` passthrough,
 *      agents[] union).
 *   B. real payload — GET the running dashboard proxy and assert no
 *      hostname appears twice + counts are summed.
 */
import { execSync } from 'node:child_process';
import { readFileSync, renameSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
};

// ── Leg A: mock fixture against the real dedup module ──────────────
console.log('Leg A — mock fixture (compiled serverDedupe.ts):');
const OUT = '/tmp/p157-rc2-dedupe';
mkdirSync(OUT, { recursive: true });
execSync(
  `npx tsc app/lib/serverDedupe.ts --outDir ${OUT} --module es2022 --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: 'inherit' },
);
renameSync(`${OUT}/serverDedupe.js`, `${OUT}/serverDedupe.mjs`);
const { dedupeByHostname } = await import(pathToFileURL(`${OUT}/serverDedupe.mjs`).href);

const fixture = [
  // same hostname, two interfaces — bridge row fresh + telemetried,
  // loopback row staler + telemetry null
  { hostname: 'host-A', ip: '172.17.0.2', agent_count: 29, last_seen: '2026-05-20 04:41:46',
    cpu_load_1min: 1.49, cpu_cores: 8, mem_used_gb: 22.6, mem_total_gb: 32,
    agents: [{ alias: 'a1' }, { alias: 'a2' }] },
  { hostname: 'host-A', ip: '127.0.0.1', agent_count: 38, last_seen: '2026-05-20 04:41:43',
    cpu_load_1min: null, mem_used_gb: null,
    agents: [{ alias: 'a2' }, { alias: 'a3' }] },
  // NAT-shared public IP, distinct hostnames — must NOT merge
  { hostname: 'host-B', ip: '223.167.142.73', agent_count: 5, last_seen: '2026-05-18 02:34:16' },
  { hostname: 'host-C', ip: '223.167.142.73', agent_count: 2, last_seen: '2026-05-13 16:44:41' },
  // sentinel hostname — two distinct unknown machines, pass through both
  { hostname: 'unknown', ip: '127.0.0.1', agent_count: 2, last_seen: '2026-05-16 08:40:14' },
  { hostname: 'unknown', ip: '10.0.0.9', agent_count: 1, last_seen: '2026-05-16 09:00:00' },
];
const out = dedupeByHostname(fixture);
const byHost = (h) => out.filter(r => r.hostname === h);
const hostA = byHost('host-A')[0];

ok('host-A collapses 2 rows → 1', byHost('host-A').length === 1, `got ${byHost('host-A').length}`);
ok('host-A agent_count summed 29+38=67', hostA?.agent_count === 67, `got ${hostA?.agent_count}`);
ok('host-A telemetry coalesced from bridge row (cpu 1.49)', hostA?.cpu_load_1min === 1.49, `got ${hostA?.cpu_load_1min}`);
ok('host-A mem coalesced (22.6)', hostA?.mem_used_gb === 22.6, `got ${hostA?.mem_used_gb}`);
ok('host-A last_seen = freshest (04:41:46)', hostA?.last_seen === '2026-05-20 04:41:46', `got ${hostA?.last_seen}`);
ok('host-A agents[] unioned + dedup by alias (a1,a2,a3)',
  hostA?.agents?.length === 3 &&
  new Set(hostA.agents.map(a => a.alias)).size === 3,
  `got ${JSON.stringify(hostA?.agents)}`);
ok('host-B + host-C NOT merged despite shared IP', byHost('host-B').length === 1 && byHost('host-C').length === 1);
ok('two `unknown` rows both pass through (not merged)', byHost('unknown').length === 2, `got ${byHost('unknown').length}`);
ok('total rows: 1 (A) + 1 (B) + 1 (C) + 2 (unknown) = 5', out.length === 5, `got ${out.length}`);

// idempotency — running dedup on already-deduped output is a no-op
const twice = dedupeByHostname(out);
ok('idempotent — dedup(dedup(x)) === dedup(x)', twice.length === out.length);

// ── Leg B: real payload through the running dashboard proxy ─────────
console.log('\nLeg B — real payload (live /api/hub/servers proxy):');
let TOKEN;
try {
  TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
} catch {
  console.log('  ⚠️  no anet config — skipping live leg');
}
if (TOKEN) {
  const res = await fetch('http://127.0.0.1:3000/api/hub/servers', {
    headers: { cookie: `anet_dashboard_session=v3:${TOKEN}` },
  });
  ok('proxy returns 200', res.status === 200, `status ${res.status}`);
  const body = await res.json();
  const servers = body.servers ?? [];
  ok('proxy returns servers[]', Array.isArray(servers) && servers.length > 0, `got ${servers.length}`);
  const counts = {};
  for (const s of servers) counts[s.hostname] = (counts[s.hostname] ?? 0) + 1;
  const dups = Object.entries(counts).filter(([h, n]) => n > 1 && h !== 'unknown' && h !== '');
  ok('no real hostname appears twice', dups.length === 0, `dups: ${JSON.stringify(dups)}`);
  const izrj = servers.find(s => s.hostname?.startsWith('iZrj93pr'));
  if (izrj) {
    ok('iZrj93pr… host present as single card', true);
    ok('iZrj93pr… has telemetry after coalesce (cpu non-null)', izrj.cpu_load_1min != null, `cpu ${izrj.cpu_load_1min}`);
    console.log(`  ℹ️  iZrj93pr… merged: agent_count=${izrj.agent_count}, cpu=${izrj.cpu_load_1min}, ip=${izrj.ip}`);
  } else {
    console.log('  ℹ️  iZrj93pr… not in current live payload (hub state changed) — structural dup check still authoritative');
  }
}

console.log(`\n${failed === 0 ? '✅ ALL GREEN' : `❌ ${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
