#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const scopeArg = process.argv.find((arg) => arg.startsWith('--scope='));
const scopeIndex = process.argv.indexOf('--scope');
const scope = scopeArg?.split('=', 2)[1]
  ?? (scopeIndex >= 0 ? process.argv[scopeIndex + 1] : undefined)
  ?? 'all';

if (!['tree', 'history', 'all'].includes(scope) || args.has('--help')) {
  console.log('usage: node scripts/oss-secret-scan.mjs --scope tree|history|all');
  process.exit(args.has('--help') ? 0 : 2);
}

// Keep this list narrow enough to avoid random hashes while covering the
// credential families used by this project and common hosting providers.
const patterns = [
  ['GitHub classic token', 'ghp_[A-Za-z0-9]{20,}'],
  ['GitHub fine-grained token', 'github_pat_[A-Za-z0-9_]{20,}'],
  ['CommHub token', '(ntok|utok|atok)_[A-Za-z0-9]{16,}'],
  ['OpenAI-style key', '(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}'],
  ['npm token', '(^|[^A-Za-z0-9])npm_[A-Za-z0-9]{20,}'],
  ['AWS access key', '(^|[^A-Z0-9])AKIA[0-9A-Z]{16}([^A-Z0-9]|$)'],
  ['Google API key', 'AIza[0-9A-Za-z_-]{30,}'],
  ['Slack token', 'xox[baprs]-[0-9A-Za-z-]{20,}'],
  ['private key', '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'],
];

const combinedPattern = patterns.map(([, pattern]) => `(${pattern})`).join('|');
const excludedPathspecs = [
  ':(exclude)package-lock.json',
  ':(exclude)npm-shrinkwrap.json',
];

function runGit(commandArgs, accepted = [0]) {
  const result = spawnSync('git', commandArgs, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!accepted.includes(result.status ?? 1)) {
    const detail = (result.stderr || result.stdout || 'unknown git error').trim();
    throw new Error(`git ${commandArgs[0]} failed: ${detail}`);
  }
  return result;
}

function scanTree() {
  const result = runGit(
    ['grep', '-Il', '-E', combinedPattern, '--', '.', ...excludedPathspecs],
    [0, 1],
  );
  const paths = result.status === 0
    ? result.stdout.trim().split('\n').filter(Boolean)
    : [];

  if (paths.length > 0) {
    console.error(`[oss-secret-scan] tree: FAIL — ${paths.length} tracked path(s) contain credential-shaped text`);
    for (const path of paths) console.error(`  ${path}`);
    return false;
  }

  console.log('[oss-secret-scan] tree: PASS — no credential-shaped text in tracked working tree');
  return true;
}

function scanHistory() {
  const shallow = runGit(['rev-parse', '--is-shallow-repository']).stdout.trim();
  if (shallow !== 'false') {
    throw new Error('history scan requires a complete clone; run git fetch --unshallow and fetch every retained branch');
  }

  const result = runGit([
    'log', '--all', '--root', '--format=__COMMIT__%H', '--patch', '--unified=0',
    `-G${combinedPattern}`, '--', '.', ...excludedPathspecs,
  ]);

  const findingMap = new Map();
  const matcher = new RegExp(combinedPattern);
  let currentCommit = null;
  let currentPath = null;
  for (const rawLine of result.stdout.split('\n')) {
    if (rawLine.startsWith('__COMMIT__')) {
      currentCommit = rawLine.slice('__COMMIT__'.length).trim();
      currentPath = null;
    } else if (rawLine.startsWith('+++ ')) {
      const path = rawLine.slice(4).trim();
      currentPath = path === '/dev/null' ? null : path.replace(/^b\//, '');
    } else if (currentCommit && currentPath && rawLine.startsWith('+') && !rawLine.startsWith('+++') && matcher.test(rawLine.slice(1))) {
      const paths = findingMap.get(currentCommit) ?? new Set();
      paths.add(currentPath);
      findingMap.set(currentCommit, paths);
    }
  }
  const findings = [...findingMap].map(([commit, paths]) => ({ commit, paths }));

  if (findings.length > 0) {
    console.error(`[oss-secret-scan] history: FAIL — ${findings.length} commit(s) introduced credential-shaped text`);
    for (const finding of findings) {
      const paths = [...finding.paths].sort();
      console.error(`  ${finding.commit.slice(0, 12)} ${paths.join(', ') || '(path unavailable)'}`);
    }
    console.error('[oss-secret-scan] values are intentionally suppressed; revoke first, then sanitize every retained ref');
    return false;
  }

  console.log('[oss-secret-scan] history: PASS — no credential-shaped changes in fetched refs');
  return true;
}

try {
  let ok = true;
  if (scope === 'tree' || scope === 'all') ok = scanTree() && ok;
  if (scope === 'history' || scope === 'all') ok = scanHistory() && ok;
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(`[oss-secret-scan] ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
