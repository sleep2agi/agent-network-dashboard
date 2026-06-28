// Stamp the commit a build was made from, so the deploy guard can tell whether
// the running build matches HEAD. Runs as `postbuild` (after `.next` exists).
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const head = execSync('git rev-parse HEAD').toString().trim();
writeFileSync('.next/BUILD_COMMIT', head + '\n');
console.log('stamp-build-commit: .next/BUILD_COMMIT =', head);
