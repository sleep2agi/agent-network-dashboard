'use client';

import { useState } from 'react';
import { useAvatarUrl } from '../lib/avatars';

/** Hue-hashed avatar pill for agent aliases. Same alias → same color across
 *  every page (Messages, Nodes, TopoGraph). Use the `size` prop for inline
 *  pills (16/20) vs card headers (28). Round 21 introduced the palette;
 *  round 22 promotes it from app/messages to a shared component. */

const AVATAR_HUES = [180, 200, 220, 270, 300, 330, 30, 90];

export function aliasAvatarColors(alias: string): { bg: string; ring: string; text: string } {
  let h = 0;
  for (let i = 0; i < alias.length; i++) h = (h * 31 + alias.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  return {
    bg: `hsl(${hue} 55% 22%)`,
    ring: `hsl(${hue} 60% 45%)`,
    text: `hsl(${hue} 80% 78%)`,
  };
}

export function aliasInitial(alias?: string): string {
  if (!alias) return '·';
  const ch = alias.trim().match(/[\p{L}\p{N}]/u)?.[0] || alias.trim()[0] || '·';
  return ch.toUpperCase();
}

function isGrokAlias(alias: string) {
  return /\bgrok\b|grok-build|grok测试员|grok-demo/i.test(alias);
}

interface AliasAvatarProps {
  alias: string;
  size?: number;
  className?: string;
}

export function AliasAvatar({ alias, size = 28, className = '' }: AliasAvatarProps) {
  // R24 (Vincent: 头像换血): a custom image (user-set or designed default)
  // wins over every generated style — ONE seam, all 13 avatar surfaces.
  // Shimmer while loading, silent fallback to the pill on error.
  const url = useAvatarUrl(alias);
  const [imgState, setImgState] = useState<'loading' | 'ready' | 'error'>('loading');
  // Reset when the url changes — React's endorsed adjust-during-render
  // pattern (no effect, no extra commit).
  const [prevUrl, setPrevUrl] = useState(url);
  if (url !== prevUrl) { setPrevUrl(url); setImgState('loading'); }
  if (url && imgState !== 'error') {
    return (
      <span
        className={`anet-alias-avatar relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border)] ${imgState === 'loading' ? 'animate-pulse bg-[var(--bg-elevated)]' : ''} ${className}`}
        style={{ width: size, height: size }}
        title={alias}
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          loading="lazy"
          onLoad={() => setImgState('ready')}
          onError={() => setImgState('error')}
          className={`h-full w-full rounded-full object-cover transition-opacity duration-150 ${imgState === 'ready' ? 'opacity-100' : 'opacity-0'}`}
        />
      </span>
    );
  }
  if (isGrokAlias(alias)) {
    return (
      <span
        className={`anet-alias-avatar inline-flex items-center justify-center rounded-full border border-emerald-500/45 bg-emerald-950/70 shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          backgroundImage: 'url(/vendors/grok.svg)',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '68% 68%',
        }}
        title={alias}
        aria-hidden
      />
    );
  }

  const c = aliasAvatarColors(alias);
  const fs = Math.max(9, Math.round(size * 0.42));
  return (
    <span
      className={`anet-alias-avatar inline-flex items-center justify-center rounded-full border shrink-0 font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: fs,
        backgroundColor: c.bg,
        borderColor: c.ring,
        color: c.text,
      }}
      title={alias}
      aria-hidden
    >
      {aliasInitial(alias)}
    </span>
  );
}
