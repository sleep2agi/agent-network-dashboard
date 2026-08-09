import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const upload = readFileSync(new URL('../app/api/hub/upload/route.ts', import.meta.url), 'utf8');
const health = readFileSync(new URL('../app/api/hub/health/route.ts', import.meta.url), 'utf8');
const resolver = readFileSync(new URL('../app/lib/hub-upload-limits.ts', import.meta.url), 'utf8');

assert.match(upload, /await resolveHubUploadLimits\(\)/, 'upload precheck must resolve server-owned limits');
assert.match(upload, /uploadLimits\.max_request_content_length/, 'envelope precheck must use Hub authority');
assert.match(upload, /uploadLimits\.max_upload_bytes/, 'user-facing cap must use Hub authority');
assert.doesNotMatch(upload, /const HUB_MAX_UPLOAD_BYTES/, 'route must not retain a private mirror');
assert.match(health, /recordHubUploadLimits\(data\)/, 'normal boot health request must warm the cache');
assert.match(resolver, /source: 'hub-health' \| 'compat-fallback'/, 'authority source must stay observable');
assert.match(resolver, /logger\.error\(/, 'compatibility fallback must be loud');
assert.match(resolver, /maxRequest < maxUpload/, 'incoherent Hub limits must be rejected');

console.log('upload-limits module contract: PASS');
