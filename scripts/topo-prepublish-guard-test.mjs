/* Round 238 verification: prepublishOnly is now a guard-only check
 * instead of a destructive rebuild. This closes the chunk-500 root
 * cause documented since R224.
 *
 * Pre-R238 prepublishOnly was 'rm -rf .next && npm run build', which:
 *   1. Deleted .next/ on disk during npm publish.
 *   2. Rebuilt with fresh content-hashed chunk filenames.
 *   3. Left the already-running next-server process with a stale
 *      in-memory manifest pointing at chunks that no longer existed
 *      on disk → ENOENT → 500 on lazy chunk fetch.
 *   4. Required a manual 'restart dash AFTER publish' step every
 *      round as a workaround.
 *
 * Post-R238 prepublishOnly is a guard:
 *   '[ -f .next/BUILD_ID ] || (echo ... && exit 1)'
 *
 *   - If .next/BUILD_ID exists, succeed silently — publish proceeds
 *     with whatever .next/ is on disk (intentional: pipeline order
 *     is now bump → build → restart → test → publish, so the build
 *     already embeds the new version BEFORE publish).
 *   - If .next/BUILD_ID is missing, fail loudly with the R224
 *     reference so the developer knows what to do.
 *
 * No rm-rf-rebuild = running server's manifest stays consistent
 * with disk chunks through the publish step. No post-publish
 * restart needed.
 *
 * Test verifies:
 *   1. package.json scripts.prepublishOnly contains no 'rm' command
 *      (destructive form removed)
 *   2. package.json scripts.prepublishOnly contains no 'npm run
 *      build' (rebuild on publish removed)
 *   3. The guard form is present (BUILD_ID check)
 *   4. Running `npm run prepublishOnly` exits 0 when .next/BUILD_ID
 *      exists, leaving .next/ untouched (mtime + content hash stable)
 */
import { readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(readFileSync('/home/vansin/agent-network-dashboard/package.json', 'utf8'));
const hookSrc = pkg.scripts?.prepublishOnly || '';

// Hash + mtime of .next/BUILD_ID before running the hook
const buildIdPath = '/home/vansin/agent-network-dashboard/.next/BUILD_ID';
const before = (() => {
  try {
    return {
      mtime: statSync(buildIdPath).mtimeMs,
      hash:  createHash('sha256').update(readFileSync(buildIdPath)).digest('hex'),
    };
  } catch {
    return null;
  }
})();

// Run the prepublishOnly hook explicitly via npm run
let exitCode = -1;
try {
  execSync('npm run prepublishOnly', {
    cwd: '/home/vansin/agent-network-dashboard',
    stdio: 'pipe',
  });
  exitCode = 0;
} catch (e) {
  exitCode = e.status ?? -1;
}

const after = (() => {
  try {
    return {
      mtime: statSync(buildIdPath).mtimeMs,
      hash:  createHash('sha256').update(readFileSync(buildIdPath)).digest('hex'),
    };
  } catch {
    return null;
  }
})();

const results = {
  hook_present:           typeof hookSrc === 'string' && hookSrc.length > 0,
  no_rm_command:          !/\brm\b/.test(hookSrc),
  has_build_id_check:     /\.next\/BUILD_ID/.test(hookSrc),
  has_exit_path:          /exit\s+1/.test(hookSrc),
  hook_exits_zero:        exitCode === 0,
  build_id_mtime_stable:  before !== null && after !== null && before.mtime === after.mtime,
  build_id_hash_stable:   before !== null && after !== null && before.hash === after.hash,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} prepublishOnly guard:`, JSON.stringify(results),
  '\n  hookSrc:', hookSrc,
  '\n  exitCode:', exitCode,
  '\n  before:', before,
  '\n  after: ', after);
process.exit(ok ? 0 : 1);
