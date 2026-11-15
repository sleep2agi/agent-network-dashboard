'use client';

import Link from 'next/link';

// 根级错误边界（2026-11-15，`.578`）—— 当 layout 本身出错时兜底。
// 注意：global-error 会替换 <html>/<body>，所以这里必须自带完整骨架与内联样式，
// 不能依赖 app/globals.css 里的 CSS 变量。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0b0d',
          color: '#e6e6e9',
          font: '14px/1.7 system-ui, -apple-system, "Noto Sans SC", sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.24em', color: '#6b7280' }}>出错了</p>
          <h1 style={{ margin: '12px 0 0', fontSize: 20, fontWeight: 600 }}>界面无法启动</h1>
          <p style={{ margin: '8px 0 0', color: '#9aa0a6' }}>
            页面外壳加载异常。可以重试；若反复出现，请把错误编号一并反馈。
          </p>
          <div style={{ marginTop: 22, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid #2a2a31',
                background: '#17171c',
                color: '#e6e6e9',
                cursor: 'pointer',
              }}
            >
              重试
            </button>
            <Link
              href="/"
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid #2a2a31',
                color: '#9aa0a6',
                textDecoration: 'none',
              }}
            >
              返回概览
            </Link>
          </div>
          {error?.digest && (
            <p style={{ marginTop: 22, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#6b7280' }}>
              错误编号 {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
