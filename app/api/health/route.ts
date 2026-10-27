import { NextResponse } from 'next/server';
import { DASHBOARD_VERSION } from '../../lib/version';

/**
 * 健康检查（不需要登录）：
 *   GET /api/health → { ok, version, commit, uptimeSec }
 *
 * 为什么要有：发布后要一眼确认「跑的是哪一版、哪个提交、活了多久」，
 * 之前只能从 /login 的 HTML 里 grep 版本号，运维脚本和监控都不好用。
 * 只暴露版本与构建提交，不碰任何 Hub 数据。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  let commit = '';
  try {
    // 构建时写入的提交（scripts/stamp-build-commit.mjs）
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    commit = readFileSync(join(process.cwd(), '.next', 'BUILD_COMMIT'), 'utf8').trim();
  } catch {
    commit = '';
  }
  return NextResponse.json({
    ok: true,
    version: DASHBOARD_VERSION,
    commit,
    uptimeSec: Math.round(process.uptime()),
  });
}
