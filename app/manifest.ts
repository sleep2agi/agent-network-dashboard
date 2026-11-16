// 注意：真正被浏览器取到的是 `public/manifest.webmanifest`（静态文件优先于本路由）。
// 本文件仅作对等备份；改 PWA 名称/描述请同时改两处，或只改 public 那份。
// （`.593` 实测：只改本文件时 /manifest.webmanifest 返回的仍是旧的 "Agent Network Dashboard"）
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Agent Network 控制台',
    short_name: 'AgentNet',
    description: 'Agent Network 与 CommHub 的移动指挥台',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0b0d',
    theme_color: '#0b0b0d',
    orientation: 'portrait',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
