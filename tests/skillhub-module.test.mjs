import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('app/skillhub/page.tsx', 'utf8');
const api = readFileSync('app/api/anet/skills/route.ts', 'utf8');
const sidebar = readFileSync('app/components/Sidebar.tsx', 'utf8');
const mobile = readFileSync('app/components/MobileNav.tsx', 'utf8');

assert.match(sidebar, /href: '\/skillhub'/, 'desktop nav must expose SkillHub');
assert.match(mobile, /href: '\/skillhub'/, 'mobile nav must expose SkillHub');
assert.match(page, /提交审核/, 'uploads must be presented as review submissions');
assert.match(page, /network_id: networkId/, 'selected Dashboard network must be sent');
assert.match(api, /requireDashboardAuth\(\)/, 'proxy must require Dashboard auth');
assert.match(api, /invoke\('submit_skill'/, 'upload must use Hub submit_skill');
assert.match(api, /invoke\('review_skill'/, 'review must use Hub review_skill');
assert.match(api, /invoke\('get_skill'/, 'detail view must use Hub get_skill');
assert.doesNotMatch(page, /HUB_TOKEN|COMMHUB_TOKEN|Authorization/, 'browser module must not carry Hub credentials');
console.log('skillhub dashboard contract: PASS');
