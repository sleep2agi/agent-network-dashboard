// Stamp the commit a build was made from, so the deploy guard can tell whether
// the running build matches HEAD. Runs as `postbuild` (after `.next` exists).
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function environmentCommit() {
  for (const value of [
    process.env.ANET_BUILD_COMMIT,
    process.env.GITHUB_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
  ]) {
    if (value && /^[0-9a-f]{7,64}$/i.test(value)) return value.toLowerCase();
  }
  return null;
}

// GitHub source archives and Docker build contexts do not contain `.git`.
// They must remain buildable, while CI can still inject an exact provenance
// marker through one of the environment variables above.
const head = gitHead() ?? environmentCommit() ?? 'source-archive';
writeFileSync('.next/BUILD_COMMIT', head + '\n');
console.log('stamp-build-commit: .next/BUILD_COMMIT =', head);
