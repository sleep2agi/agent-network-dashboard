import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Agent Network Dashboard',
    short_name: 'AgentNet',
    description: 'Mobile command surface for Agent Network and CommHub',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a1a',
    theme_color: '#0a0a1a',
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
