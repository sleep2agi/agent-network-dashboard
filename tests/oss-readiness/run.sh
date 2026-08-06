#!/bin/sh
set -eu

git config --global user.name 'OSS Gate Fixture'
git config --global user.email 'oss-gate@example.invalid'

echo 'L0 source archives without .git retain build provenance behavior'
mkdir -p /tmp/stamp-fixture/.next /tmp/stamp-fixture/scripts
cp scripts/stamp-build-commit.mjs /tmp/stamp-fixture/scripts/
cd /tmp/stamp-fixture
node scripts/stamp-build-commit.mjs
grep -qx 'source-archive' .next/BUILD_COMMIT
ANET_BUILD_COMMIT=0123456789abcdef node scripts/stamp-build-commit.mjs
grep -qx '0123456789abcdef' .next/BUILD_COMMIT

echo 'L1 tree and documentation checks'
cd /src
git init -q
git add .
git commit -qm 'fixture: candidate tree'
node scripts/oss-readiness-check.mjs

echo 'L2 tree mutation must be witnessed red'
mkdir -p /tmp/tree-mutation
cp scripts/oss-secret-scan.mjs scripts/oss-binary-scan.mjs /tmp/tree-mutation/
cd /tmp/tree-mutation
git init -q
printf 'credential=%s_%s\n' 'ghp' 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' > leaked.txt
git add .
git commit -qm 'fixture: leaked tree value'
if node oss-secret-scan.mjs --scope tree >/tmp/tree-mutation.out 2>&1; then
  echo 'FAIL: tree mutation stayed green' >&2
  exit 1
fi
grep -q 'tree: FAIL' /tmp/tree-mutation.out
grep -q 'leaked.txt' /tmp/tree-mutation.out
if grep -q 'AAAAAAAAAAAAAAAAAAAA' /tmp/tree-mutation.out; then
  echo 'FAIL: scanner printed the credential value' >&2
  exit 1
fi

echo 'L2b binary mutation must be witnessed red'
printf '\211PNG\r\n\032\n\000credential=%s_%s\000' 'ghp' 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' > leaked.png
git add leaked.png
git commit -qm 'fixture: credential bytes in binary'
if node oss-binary-scan.mjs >/tmp/binary-mutation.out 2>&1; then
  echo 'FAIL: binary credential mutation stayed green' >&2
  exit 1
fi
grep -q 'credential_shape: leaked.png' /tmp/binary-mutation.out
if grep -q 'BBBBBBBBBBBBBBBBBBBB' /tmp/binary-mutation.out; then
  echo 'FAIL: binary scanner printed the credential value' >&2
  exit 1
fi
rm leaked.png
git add leaked.png
git commit -qm 'fixture: remove binary credential'

echo 'L3 deleted-history mutation must be witnessed red'
printf 'redacted\n' > leaked.txt
git add leaked.txt
git commit -qm 'fixture: remove leaked value from tip'
node oss-secret-scan.mjs --scope tree
if node oss-secret-scan.mjs --scope history >/tmp/history-mutation.out 2>&1; then
  echo 'FAIL: deleted historical credential stayed green' >&2
  exit 1
fi
grep -q 'history: FAIL' /tmp/history-mutation.out
grep -q 'leaked.txt' /tmp/history-mutation.out
if grep -q 'AAAAAAAAAAAAAAAAAAAA' /tmp/history-mutation.out; then
  echo 'FAIL: history scanner printed the credential value' >&2
  exit 1
fi

echo 'L4 clean history passes'
mkdir -p /tmp/clean-history
cp /src/scripts/oss-secret-scan.mjs /tmp/clean-history/
cd /tmp/clean-history
git init -q
printf 'safe fixture\n' > safe.txt
git add .
git commit -qm 'fixture: safe history'
node oss-secret-scan.mjs --scope all

echo 'L5 shallow history must fail closed'
git clone -q --depth 1 "file:///tmp/tree-mutation" /tmp/shallow-history
cd /tmp/shallow-history
cp /src/scripts/oss-secret-scan.mjs .
if node oss-secret-scan.mjs --scope history >/tmp/shallow-history.out 2>&1; then
  echo 'FAIL: shallow history was accepted as complete' >&2
  exit 1
fi
grep -q 'complete clone' /tmp/shallow-history.out

echo 'L6 public-surface scanner clean controls and mutations'
mkdir -p /tmp/surface-clean
cp /src/scripts/oss-public-surface-scan.mjs /tmp/surface-clean/
cd /tmp/surface-clean
git init -q
printf 'portable fixture\n' > safe.txt
git add .
git commit -qm 'fixture: portable public tree'
node oss-public-surface-scan.mjs --scope tree

printf '/%s/%s/project\n' 'home' 'example-user' > private-path.txt
git add private-path.txt
git commit -qm 'fixture: private path'
if node oss-public-surface-scan.mjs --scope tree >/tmp/surface-tree.out 2>&1; then
  echo 'FAIL: private path mutation stayed green' >&2
  exit 1
fi
grep -q 'personal_home' /tmp/surface-tree.out
grep -q 'private-path.txt' /tmp/surface-tree.out
fixture_home=$(printf '/%s/%s' 'home' 'example-user')
if grep -q "$fixture_home" /tmp/surface-tree.out; then
  echo 'FAIL: public-surface scanner printed matched text' >&2
  exit 1
fi

printf '{"repository":{"description":"safe"},"items":[{"number":7,"title":"fixture","body":"https://private.example.invalid/path"},{"number":10,"title":"safe PR","body":"safe","pull_request":{}}],"issue_comments":[{"id":8,"issue_url":"https://api.github.invalid/repos/o/r/issues/7","body":"ghp_%s"}],"review_comments":[{"id":11,"pull_request_url":"https://api.github.invalid/repos/o/r/pulls/10","body":"safe"}],"releases":[{"id":9,"body":"/%s/%s/release","assets":[{"name":"one.apk"},{"name":"two.zip"}]}],"branches":[{"name":"main"}],"tags":[]}\n' 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' 'home' 'example-user' > /tmp/surface-github.json
if OSS_PRIVATE_HOST_SUFFIXES=example.invalid node oss-public-surface-scan.mjs --scope github --fixture /tmp/surface-github.json >/tmp/surface-github.out 2>&1; then
  echo 'FAIL: GitHub metadata mutation stayed green' >&2
  exit 1
fi
grep -q 'personal_domain' /tmp/surface-github.out
grep -q 'credential_shape' /tmp/surface-github.out
grep -q 'issue#7' /tmp/surface-github.out
grep -q 'release#9' /tmp/surface-github.out
grep -q 'repository_metadata: scanned=1' /tmp/surface-github.out
grep -q 'issues: scanned=1' /tmp/surface-github.out
grep -q 'pull_requests: scanned=1' /tmp/surface-github.out
grep -q 'issue_and_pr_comments: scanned=1' /tmp/surface-github.out
grep -q 'pull_request_review_comments: scanned=1' /tmp/surface-github.out
grep -q 'releases: scanned=1' /tmp/surface-github.out
grep -q 'release_asset_names: scanned=2' /tmp/surface-github.out
grep -q 'branches: scanned=1' /tmp/surface-github.out
grep -q 'tags: scanned=0' /tmp/surface-github.out
grep -q 'actions_run_logs: NOT COVERED' /tmp/surface-github.out
grep -q 'actions_artifact_contents: NOT COVERED' /tmp/surface-github.out
grep -q 'release_asset_contents: NOT COVERED' /tmp/surface-github.out
grep -q 'wiki_pages: NOT COVERED' /tmp/surface-github.out
grep -q 'pages_site: NOT COVERED' /tmp/surface-github.out
grep -q 'discussions: NOT COVERED' /tmp/surface-github.out
if grep -Eq 'private\.example\.invalid|AAAAAAAAAAAAAAAAAAAA' /tmp/surface-github.out; then
  echo 'FAIL: public-surface scanner printed matched metadata' >&2
  exit 1
fi

node -e "const fs=require('fs');const p='/tmp/surface-github.json';const value=JSON.parse(fs.readFileSync(p));delete value.tags;fs.writeFileSync('/tmp/surface-github-incomplete.json',JSON.stringify(value))"
if OSS_PRIVATE_HOST_SUFFIXES=example.invalid node oss-public-surface-scan.mjs --scope github --fixture /tmp/surface-github-incomplete.json >/tmp/surface-github-incomplete.out 2>&1; then
  echo 'FAIL: incomplete GitHub surface fixture was accepted as complete' >&2
  exit 1
fi
grep -q 'coverage data missing required surface: tags' /tmp/surface-github-incomplete.out

echo 'L7 lint and production build'
cd /src
npm run lint
npm run build

echo 'L8 complete and production dependency audits'
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high

echo 'L9 package-content audit'
npm pack --json > /tmp/npm-pack.json
node <<'NODE'
const report = require('/tmp/npm-pack.json');
const files = report[0]?.files?.map((entry) => entry.path) ?? [];
const forbidden = files.filter((path) =>
  path.startsWith('.env')
  || path.startsWith('.anet/')
  || path.startsWith('.git/')
  || path.startsWith('docs/')
  || path.startsWith('tests/')
  || path.startsWith('screenshots/')
  || path.startsWith('android/')
  || path.startsWith('ios/')
  || path.endsWith('.log')
);
if (forbidden.length > 0) {
  console.error(`package-content FAIL: ${forbidden.length} forbidden file(s)`);
  for (const path of forbidden.slice(0, 40)) console.error(`  ${path}`);
  process.exit(1);
}
if (
  !files.includes('bin/start.js')
  || !files.includes('apps/desktop/electron/main.cjs')
  || !files.includes('.next/BUILD_ID')
) {
  console.error('package-content FAIL: declared launcher, main entry, or production build missing');
  process.exit(1);
}
console.log(`package-content PASS: ${files.length} files; runtime launcher and build present`);
NODE

archive=$(node -p "require('/tmp/npm-pack.json')[0].filename")
mkdir -p /tmp/candidate-package
tar -xzf "$archive" -C /tmp/candidate-package
node <<'NODE'
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');
const root = '/tmp/candidate-package';
const operator = ['van', 'sin'].join('');
const rules = [
  ['personal_home', new RegExp(`/home/${operator}(?:/|\\b)`, 'i')],
  ['personal_domain', new RegExp(`(?:[A-Za-z0-9-]+\\.)*${operator}\\.(?:me|top)`, 'i')],
  ['credential_github', /(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['credential_commhub', /(?:ntok|utok|atok)_[A-Za-z0-9]{16,}/],
  ['credential_openai', /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/],
  ['credential_npm', /(?:^|[^A-Za-z0-9])npm_[A-Za-z0-9]{20,}/],
  ['credential_aws', /(?:^|[^A-Z0-9])AKIA[0-9A-Z]{16}(?:[^A-Z0-9]|$)/],
  ['credential_google', /AIza[0-9A-Za-z_-]{30,}/],
  ['credential_slack', /xox[baprs]-[0-9A-Za-z-]{20,}/],
  ['credential_private_key', /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/],
];
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const findings = [];
for (const path of walk(root)) {
  let text;
  try { text = readFileSync(path).toString('latin1'); } catch { continue; }
  for (const [category, pattern] of rules) {
    if (pattern.test(text)) findings.push({ category, path: relative(root, path) });
  }
}
if (findings.length > 0) {
  console.error(`package-surface FAIL: ${findings.length} finding(s)`);
  for (const finding of findings.slice(0, 60)) console.error(`  ${finding.category}\t${finding.path}`);
  console.error('matched values are intentionally suppressed');
  process.exit(1);
}
console.log('package-surface PASS: no credential or private deployment markers');
NODE
unlink "$archive"

echo 'RESULT: PASS — OSS readiness, secret/surface mutations, build, dependency, and package gates'
