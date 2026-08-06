#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const valueFor = (name) => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const scope = valueFor('--scope') ?? 'all';
const repository = valueFor('--repo') ?? 'sleep2agi/agent-network-dashboard';
const fixturePath = valueFor('--fixture');
if (!['tree', 'github', 'all'].includes(scope) || argv.includes('--help')) {
  console.log('usage: node scripts/oss-public-surface-scan.mjs --scope tree|github|all [--repo owner/name] [--fixture file.json]');
  process.exit(argv.includes('--help') ? 0 : 2);
}

// Match non-portable user-home paths generically. Private host suffixes are
// deployment-specific and may be supplied without committing them to source.
const personalHome = new RegExp([
  '(?:^|[^A-Za-z0-9])/',
  '(?:home|Users)',
  '/[A-Za-z0-9._-]+(?:/|\\b)',
].join(''), 'i');
const privateHostSuffixes = (process.env.OSS_PRIVATE_HOST_SUFFIXES ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
for (const suffix of privateHostSuffixes) {
  if (!/^[a-z0-9.-]+$/.test(suffix) || suffix.startsWith('.') || suffix.endsWith('.')) {
    throw new Error(`invalid OSS_PRIVATE_HOST_SUFFIXES entry: ${suffix}`);
  }
}
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const privateDomains = privateHostSuffixes.map((suffix) => new RegExp(
  `(?:^|[^A-Za-z0-9.-])(?:[A-Za-z0-9-]+\\.)*${escapeRegExp(suffix)}(?::\\d+)?(?:\\b|/)`,
  'i',
));
const credentialPatterns = [
  new RegExp(['ghp', '[A-Za-z0-9]{20,}'].join('_')),
  new RegExp(['github', 'pat', '[A-Za-z0-9_]{20,}'].join('_')),
  new RegExp(`(?:${['ntok', 'utok', 'atok'].join('|')})_[A-Za-z0-9]{16,}`),
  /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/,
  /(?:^|[^A-Za-z0-9])npm_[A-Za-z0-9]{20,}/,
  /(?:^|[^A-Z0-9])AKIA[0-9A-Z]{16}(?:[^A-Z0-9]|$)/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /xox[baprs]-[0-9A-Za-z-]{20,}/,
  new RegExp(['-----BEGIN', '(?: [A-Z0-9]+)* PRIVATE KEY-----'].join('')),
];

function run(command, args, accepted = [0]) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!accepted.includes(result.status ?? 1)) {
    const detail = (result.stderr || result.stdout || `${command} failed`).trim();
    throw new Error(detail);
  }
  return result.stdout;
}

function categories(text) {
  const found = [];
  if (personalHome.test(text)) found.push('personal_home');
  if (privateDomains.some((pattern) => pattern.test(text))) found.push('personal_domain');
  if (credentialPatterns.some((pattern) => pattern.test(text))) found.push('credential_shape');
  return found;
}

function printFindings(label, findings) {
  if (findings.length === 0) {
    console.log(`[oss-public-surface] ${label}: PASS — no private deployment markers found`);
    return true;
  }
  console.error(`[oss-public-surface] ${label}: FAIL — ${findings.length} finding(s)`);
  const byCategory = new Map();
  for (const finding of findings) {
    const group = byCategory.get(finding.category) ?? [];
    group.push(finding);
    byCategory.set(finding.category, group);
  }
  for (const [category, group] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`  ${category}: ${group.length}`);
    for (const finding of group.slice(0, 20)) console.error(`    ${finding.location}`);
    if (group.length > 20) console.error(`    ... ${group.length - 20} more location(s) suppressed`);
  }
  console.error('[oss-public-surface] matched values are intentionally suppressed');
  return false;
}

function printGithubCoverage(data) {
  const issues = data.items.filter((item) => !item.pull_request).length;
  const pullRequests = data.items.length - issues;
  const releaseAssets = data.releases.reduce((total, release) => total + (release.assets?.length ?? 0), 0);
  const covered = [
    ['repository_metadata', 1],
    ['issues', issues],
    ['pull_requests', pullRequests],
    ['issue_and_pr_comments', data.issue_comments.length],
    ['pull_request_review_comments', data.review_comments.length],
    ['releases', data.releases.length],
    ['release_asset_names', releaseAssets],
    ['branches', data.branches.length],
    ['tags', data.tags.length],
  ];
  const uncovered = [
    'release_asset_contents',
    'actions_run_logs',
    'actions_artifact_contents',
    'wiki_pages',
    'pages_site',
    'discussions',
  ];

  console.log('[oss-public-surface] github coverage:');
  for (const [surface, count] of covered) console.log(`  ${surface}: scanned=${count}`);
  for (const surface of uncovered) console.log(`  ${surface}: NOT COVERED`);
}

function requireGithubCoverageData(data) {
  if (!data.repository || typeof data.repository !== 'object') {
    throw new Error('GitHub coverage data missing required surface: repository');
  }
  for (const surface of ['items', 'issue_comments', 'review_comments', 'releases', 'branches', 'tags']) {
    if (!Array.isArray(data[surface])) throw new Error(`GitHub coverage data missing required surface: ${surface}`);
  }
}

function scanTree() {
  const paths = run('git', ['ls-files', '-z']).split('\0').filter(Boolean);
  console.log(`[oss-public-surface] tree coverage: tracked_files=${paths.length}`);
  console.log(privateHostSuffixes.length > 0
    ? `[oss-public-surface] private_host_suffixes: configured=${privateHostSuffixes.length}`
    : '[oss-public-surface] private_host_suffixes: NOT CONFIGURED');
  const findings = [];
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const category of categories(text)) findings.push({ category, location: path });
  }
  return printFindings('tree', findings);
}

function readGithubFixture() {
  if (fixturePath) return JSON.parse(readFileSync(fixturePath, 'utf8'));
  const endpoint = (path) => JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/${path}`])).flat();
  return {
    repository: JSON.parse(run('gh', ['api', `repos/${repository}`])),
    items: endpoint('issues?state=all&per_page=100'),
    issue_comments: endpoint('issues/comments?per_page=100'),
    review_comments: endpoint('pulls/comments?per_page=100'),
    releases: endpoint('releases?per_page=100'),
    branches: endpoint('branches?per_page=100'),
    tags: endpoint('tags?per_page=100'),
  };
}

function scanGithub() {
  const data = readGithubFixture();
  requireGithubCoverageData(data);
  printGithubCoverage(data);
  const findings = [];
  for (const category of categories(`${data.repository?.description ?? ''}\n${data.repository?.homepage ?? ''}`)) {
    findings.push({ category, location: 'repository-metadata' });
  }
  for (const item of data.items ?? []) {
    const kind = item.pull_request ? 'pr' : 'issue';
    for (const category of categories(`${item.title ?? ''}\n${item.body ?? ''}`)) {
      findings.push({ category, location: `${kind}#${item.number}` });
    }
  }
  for (const comment of data.issue_comments ?? []) {
    const issue = String(comment.issue_url ?? '').split('/').pop() || 'unknown';
    for (const category of categories(comment.body ?? '')) {
      findings.push({ category, location: `issue#${issue}:comment#${comment.id ?? 'unknown'}` });
    }
  }
  for (const comment of data.review_comments ?? []) {
    const pull = String(comment.pull_request_url ?? '').split('/').pop() || 'unknown';
    for (const category of categories(comment.body ?? '')) {
      findings.push({ category, location: `pr#${pull}:review-comment#${comment.id ?? 'unknown'}` });
    }
  }
  for (const release of data.releases ?? []) {
    const text = [release.name, release.tag_name, release.body, ...(release.assets ?? []).map((asset) => asset.name)].filter(Boolean).join('\n');
    for (const category of categories(text)) {
      findings.push({ category, location: `release#${release.id ?? 'unknown'}` });
    }
  }
  for (const branch of data.branches ?? []) {
    const ref = String(branch.commit?.sha ?? 'unknown').slice(0, 12);
    for (const category of categories(branch.name ?? '')) findings.push({ category, location: `branch@${ref}` });
  }
  for (const tag of data.tags ?? []) {
    const ref = String(tag.commit?.sha ?? 'unknown').slice(0, 12);
    for (const category of categories(tag.name ?? '')) findings.push({ category, location: `tag@${ref}` });
  }
  return printFindings('github', findings);
}

try {
  let ok = true;
  if (scope === 'tree' || scope === 'all') ok = scanTree() && ok;
  if (scope === 'github' || scope === 'all') ok = scanGithub() && ok;
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(`[oss-public-surface] ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
