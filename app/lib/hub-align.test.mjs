import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CREATE_FLAG_KEYS,
  EDITABLE_CHANNELS,
  HUB_CREATE_RUNTIME_IDS,
  HUB_PERMISSION_MODES,
  narrowEditableChannels,
  reportedRuntimeCatalog,
} from './hub-align.mjs';

assert.deepEqual(EDITABLE_CHANNELS, ['telegram', 'feishu']);
assert.equal(EDITABLE_CHANNELS.includes('commhub'), false);

assert.deepEqual(narrowEditableChannels(undefined), undefined);
assert.deepEqual(narrowEditableChannels(['commhub', 'telegram']), ['telegram']);
assert.deepEqual(narrowEditableChannels(['commhub']), []);
assert.deepEqual(narrowEditableChannels([]), []);
assert.deepEqual(narrowEditableChannels(['Telegram', 'telegram', 'nope']), ['telegram']);
assert.equal(narrowEditableChannels('telegram'), undefined);

assert.deepEqual([...HUB_CREATE_RUNTIME_IDS], [
  'claude-agent-sdk',
  'claude-code-cli',
  'codex-sdk',
  'codex-app-server',
  'grok-build-acp',
  'grok-build-cli',
  'opencode-cli',
]);
assert.equal(HUB_CREATE_RUNTIME_IDS.includes('codex'), false);
assert.equal(HUB_CREATE_RUNTIME_IDS.includes('grok'), false);
assert.equal(HUB_PERMISSION_MODES.includes('auto'), false);
assert.equal(CREATE_FLAG_KEYS.includes('model'), false);
assert.equal(CREATE_FLAG_KEYS.includes('opencodeUnsafeTools'), false);

// Prefix matches the drop rule. The suffix stays shorter than the OSS
// scanners' sk- threshold so this fixture is not credential-shaped text.
const planted = 'sk-dropped';
const catalog = reportedRuntimeCatalog({
  'codex-sdk': {
    state: 'ready',
    reason: '可以创建',
    models: ['gpt-5.5', 'openai/gpt-5.5', planted],
    model_providers: [{
      id: 'openai',
      base_url: 'https://user:secret@example.test/v1',
      api_key: planted,
      models: ['gpt-5.5'],
    }],
  },
  'opencode-cli': {
    models: ['opencode/mimo-v2.5-free'],
    providers: [{ id: 'opencode', base_url: 'https://opencode.ai/v1', models: ['opencode/mimo-v2.5-free'] }],
  },
}, 'codex-sdk');

assert.equal(catalog.present, true);
assert.deepEqual(catalog.models, ['gpt-5.5']);
assert.equal(JSON.stringify(catalog).includes(planted), false);
assert.equal(JSON.stringify(catalog).includes('secret'), false);
assert.equal(catalog.providers[0].baseUrl, undefined);

const opencode = reportedRuntimeCatalog({
  'opencode-cli': { models: ['opencode/mimo-v2.5-free'], api_key: planted },
}, 'opencode-cli');
assert.deepEqual(opencode.models, ['opencode/mimo-v2.5-free']);
assert.equal(JSON.stringify(opencode).includes(planted), false);

assert.equal(reportedRuntimeCatalog({}, 'codex-sdk').present, false);
assert.equal(reportedRuntimeCatalog({ 'codex-sdk': { state: 'missing_cli', reason: '未安装' } }, 'codex-sdk').present, true);

const createRoute = readFileSync(new URL('../api/anet/node-create/route.ts', import.meta.url), 'utf8');
assert.match(createRoute, /HUB_CREATE_RUNTIME_IDS/);
assert.doesNotMatch(createRoute, /\['claude-agent-sdk', 'codex', 'grok'\]/);
assert.match(createRoute, /\/api\/node-create-requests/);
assert.doesNotMatch(createRoute, /pending contract Q2/);

const configRoute = readFileSync(new URL('../api/anet/node-config/route.ts', import.meta.url), 'utf8');
assert.match(configRoute, /narrowEditableChannels/);
assert.doesNotMatch(configRoute, /'commhub'/);

const settings = readFileSync(new URL('../components/NodeSettingsPanel.tsx', import.meta.url), 'utf8');
assert.match(settings, /HUB_PERMISSION_MODES/);
assert.doesNotMatch(settings, /'auto', 'default', 'bypassPermissions'/);

const requirements = readFileSync(new URL('../api/hub/requirements/route.ts', import.meta.url), 'utf8');
assert.match(requirements, /X-Anet-Accept-Columns/);
assert.match(requirements, /abandoned/);

console.log('hub-align contract: PASS');
