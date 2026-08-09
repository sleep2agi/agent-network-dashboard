import { afterEach, describe, expect, test } from 'bun:test';
import {
  COMPAT_UPLOAD_LIMITS,
  parseHubUploadLimits,
  recordHubUploadLimits,
  resetHubUploadLimitsForTest,
  resolveHubUploadLimits,
} from './hub-upload-limits';

afterEach(() => resetHubUploadLimitsForTest());

const authoritative = {
  limits: { max_upload_bytes: 20_000_000, max_request_content_length: 21_000_000 },
};

describe('#496 authoritative Hub upload limits', () => {
  test('strictly parses positive coherent integer limits', () => {
    expect(parseHubUploadLimits(authoritative)).toEqual(authoritative.limits);
    expect(parseHubUploadLimits({ limits: { ...authoritative.limits, max_upload_bytes: '20000000' } })).toBeNull();
    expect(parseHubUploadLimits({ limits: { max_upload_bytes: 20, max_request_content_length: 19 } })).toBeNull();
    expect(parseHubUploadLimits({})).toBeNull();
  });

  test('concurrent callers share one health fetch and cache its authority', async () => {
    let calls = 0;
    const fetchHealth = async () => { calls += 1; await Bun.sleep(10); return authoritative; };
    const [a, b] = await Promise.all([
      resolveHubUploadLimits({ fetchHealth }),
      resolveHubUploadLimits({ fetchHealth }),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual({ ...authoritative.limits, source: 'hub-health' });
    expect(b).toEqual(a);
    await resolveHubUploadLimits({ fetchHealth: async () => { throw new Error('must not run'); } });
    expect(calls).toBe(1);
  });

  test('invalid/unavailable health uses the compatibility value and logs loudly once', async () => {
    const messages: string[] = [];
    const logger = { error: (message: string) => messages.push(message) };
    const first = await resolveHubUploadLimits({ fetchHealth: async () => ({}), logger });
    const second = await resolveHubUploadLimits({ fetchHealth: async () => { throw new Error('must not run'); }, logger });
    expect(first).toEqual({ ...COMPAT_UPLOAD_LIMITS, source: 'compat-fallback' });
    expect(second).toEqual(first);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('compatibility upload limits');
  });

  test('the boot health path can replace an earlier compatibility fallback', async () => {
    await resolveHubUploadLimits({ fetchHealth: async () => { throw new Error('old Hub'); }, logger: { error() {} } });
    expect(recordHubUploadLimits(authoritative)).toBe(true);
    expect(await resolveHubUploadLimits()).toEqual({ ...authoritative.limits, source: 'hub-health' });
  });

  test('a late lazy-fetch failure cannot overwrite a boot health authority', async () => {
    let rejectFetch!: (error: Error) => void;
    const pending = new Promise<unknown>((_resolve, reject) => { rejectFetch = reject; });
    const resolving = resolveHubUploadLimits({ fetchHealth: () => pending, logger: { error() {} } });
    expect(recordHubUploadLimits(authoritative)).toBe(true);
    rejectFetch(new Error('late failure'));
    expect(await resolving).toEqual({ ...authoritative.limits, source: 'hub-health' });
  });
});
