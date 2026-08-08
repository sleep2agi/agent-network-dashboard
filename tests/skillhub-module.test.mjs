import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

console.log(`source_commit=${process.env.SKILLHUB_DASHBOARD_SOURCE_COMMIT || 'unknown'}`);

const page = readFileSync('app/skillhub/page.tsx', 'utf8');
const api = readFileSync('app/api/anet/skills/route.ts', 'utf8');
const sidebar = readFileSync('app/components/Sidebar.tsx', 'utf8');
const mobile = readFileSync('app/components/MobileNav.tsx', 'utf8');

assert.match(sidebar, /href: '\/skillhub'/, 'desktop nav must expose SkillHub');
assert.match(mobile, /href: '\/skillhub'/, 'mobile nav must expose SkillHub');
assert.match(page, /提交审核/, 'uploads must be presented as review submissions');
assert.match(page, /导出公共投稿包/, 'published private skills need an explicit public export action');
assert.match(page, /不会自动公开/, 'public export must not claim automatic publication');
assert.match(page, /网络内发布/, 'private published status must not be mislabeled as Internet-public');
assert.match(page, /selected\.status === 'published'/, 'only network-published skills may be exported');
assert.match(page, /reviewer && selected\.status/, 'public export must stay reviewer-gated');
assert.match(page, /content_sha256: contentSha256/, 'public bundle must bind exact content');
assert.match(page, /license: publicLicense/, 'public export must require an explicit license');
assert.doesNotMatch(page.match(/const publicBundle = \{[\s\S]*?\n    \};/)?.[0] || '', /network_id|source_alias|skill_id|review_note/, 'public bundle must omit private identity and review fields');
assert.match(page, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/, 'download URL must remain valid through the click dispatch');
assert.match(page, /network_id: networkId/, 'selected Dashboard network must be sent');
assert.match(api, /requireDashboardAuth\(\)/, 'proxy must require Dashboard auth');
assert.match(api, /invoke\('submit_skill'/, 'upload must use Hub submit_skill');
assert.match(api, /invoke\('review_skill'/, 'review must use Hub review_skill');
assert.match(api, /invoke\('get_skill'/, 'detail view must use Hub get_skill');
assert.match(api, /unknown tool\|tool\.\+not found\|not registered/, '200-level missing-tool errors must stay honest');
assert.doesNotMatch(page, /HUB_TOKEN|COMMHUB_TOKEN|Authorization/, 'browser module must not carry Hub credentials');
console.log('skillhub dashboard contract: PASS');
