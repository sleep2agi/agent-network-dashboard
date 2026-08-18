#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const failures = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

const pkg = JSON.parse(read('package.json'));
const readme = read('README.md');
const contributing = read('CONTRIBUTING.md');
const security = read('SECURITY.md');
const gatesDoc = read('docs/oss-security-gates.md');
const gitignore = read('.gitignore');
const envExample = read('.env.example');
const desktopMain = read('apps/desktop/electron/main.cjs');
const capacitorConfig = read('capacitor.config.ts');
const androidMain = read('android/app/src/main/java/ai/sleep2agi/agentnetwork/dashboard/MainActivity.java');

check(pkg.name === '@sleep2agi/agent-network-dashboard', 'published package name must remain backward compatible');
check(pkg.license === 'Apache-2.0', 'package.json license must be Apache-2.0');
check(pkg.engines?.node === '>=20', 'package.json must declare the documented Node.js floor');
check(pkg.repository?.url === 'https://github.com/sleep2agi/agent-network-dashboard', 'package metadata must name the public source repository');
check(pkg.bugs?.url === 'https://github.com/sleep2agi/agent-network-dashboard/issues', 'package metadata must name the issue tracker');
check(pkg.homepage === 'https://anet.sh', 'package metadata must name the project homepage');
check(read('LICENSE').includes('Apache License'), 'LICENSE must contain the Apache License');
check(readme.includes('Apache-2.0'), 'README must state Apache-2.0');
check(!/^MIT\s*$/m.test(readme), 'README must not claim an MIT license');
check(
  contributing.includes('github.com/sleep2agi/agent-network-dashboard.git'),
  'CONTRIBUTING must clone the Dashboard repository',
);
check(contributing.includes('npm ci'), 'CONTRIBUTING must use the Dashboard npm workflow');
check(
  security.includes('agent-network-dashboard/security/advisories/new'),
  'SECURITY must point to this repository private advisory page',
);
check(!readme.includes('repository is still private'), 'public README must not carry the predecessor repository freeze banner');
check(readme.includes('npm package remains `@sleep2agi/agent-network-dashboard`'), 'README must preserve the established package name');
check(gatesDoc.includes('NOT COVERED'), 'OSS gate documentation must explain uncovered-surface reporting');
check(gatesDoc.includes('full clone'), 'OSS gate documentation must require a full clone for history attestation');
check(gitignore.includes('!.env.example'), '.gitignore must allow the safe environment example');
check(envExample.includes('127.0.0.1'), '.env.example must default to local services');
check(!envExample.includes('DASHBOARD_PASSWORD=replace-with-a-real'), '.env.example must not look like a real credential');
check(desktopMain.includes('http://127.0.0.1:3000'), 'desktop launcher must default to a local Dashboard');
check(capacitorConfig.includes('http://127.0.0.1:3000'), 'Capacitor development must default to a local Dashboard');
check(androidMain.includes('DEFAULT_URL = ""'), 'Android must require an explicit Dashboard URL');

const tracked = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
check(tracked.status === 0, 'git ls-files must succeed');
const trackedPaths = tracked.stdout.split('\n').filter(Boolean);
const forbiddenTracked = trackedPaths.filter((path) =>
  path === '.env'
  || path.startsWith('.anet/')
  || path.startsWith('.next/')
  || /\.(pem|p12|pfx|tgz|log)$/i.test(path)
  || /(^|\/)(id_rsa|id_ed25519)$/i.test(path)
);
check(forbiddenTracked.length === 0, `forbidden tracked artifacts: ${forbiddenTracked.join(', ')}`);
check(!trackedPaths.some((path) => path.startsWith('screenshots/') || path.includes('/screenshots/')), 'internal visual evidence must not be tracked');
check(!trackedPaths.includes('.mcp.json'), 'private MCP workspace configuration must not be tracked');

const publicScreenshots = [
  'docs/images/dashboard-chat.png',
  'docs/images/dashboard-topology.png',
];
for (const screenshot of publicScreenshots) {
  check(existsSync(screenshot), `public screenshot must exist: ${screenshot}`);
  check(readme.includes(`](${screenshot})`), `README must reference public screenshot: ${screenshot}`);
}

const publicRootScripts = new Set([
  'scripts/build-guard.sh',
  'scripts/check-avatars.mjs',
  'scripts/check-color-ratchet.mjs',
  'scripts/color-ratchet-baseline.json',
  'scripts/oss-binary-scan.mjs',
  'scripts/oss-public-surface-scan.mjs',
  'scripts/oss-readiness-check.mjs',
  'scripts/oss-secret-scan.mjs',
  // 单测聚合 runner(#26)。只做三件事:遍历 tests/ 与 app/ 找 *.test.{mjs,mts}、
  // 按文件是否 import node:test/bun:test 分派给 `node` 或 `bun test`、聚合退出码。
  // 不读任何凭据、不发网络请求、不写仓外路径。
  'scripts/run-tests.mjs',
  'scripts/stamp-build-commit.mjs',
]);
const unexpectedRootScripts = trackedPaths.filter((path) => path.startsWith('scripts/') && !publicRootScripts.has(path));
check(unexpectedRootScripts.length === 0, `unreviewed root scripts: ${unexpectedRootScripts.join(', ')}`);

const secretScan = spawnSync(
  process.execPath,
  ['scripts/oss-secret-scan.mjs', '--scope', 'tree'],
  { encoding: 'utf8' },
);
check(secretScan.status === 0, 'working-tree credential scan must pass');
if (secretScan.stdout.trim()) console.log(secretScan.stdout.trim());
if (secretScan.status !== 0 && secretScan.stderr.trim()) console.error(secretScan.stderr.trim());

const surfaceScan = spawnSync(
  process.execPath,
  ['scripts/oss-public-surface-scan.mjs', '--scope', 'tree'],
  { encoding: 'utf8' },
);
check(surfaceScan.status === 0, 'working-tree portability scan must pass');
if (surfaceScan.stdout.trim()) console.log(surfaceScan.stdout.trim());
if (surfaceScan.status !== 0 && surfaceScan.stderr.trim()) console.error(surfaceScan.stderr.trim());

const binaryScan = spawnSync(
  process.execPath,
  ['scripts/oss-binary-scan.mjs'],
  { encoding: 'utf8' },
);
check(binaryScan.status === 0, 'tracked-binary byte scan must pass');
if (binaryScan.stdout.trim()) console.log(binaryScan.stdout.trim());
if (binaryScan.status !== 0 && binaryScan.stderr.trim()) console.error(binaryScan.stderr.trim());

if (failures.length > 0) {
  console.error(`[oss-readiness] FAIL — ${failures.length}/${checks} checks failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`[oss-readiness] PASS — ${checks}/${checks} checks passed`);
