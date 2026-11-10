'use client';

import { useState, useSyncExternalStore } from 'react';
import { useAvatarUrl } from '../lib/avatars';

/** Hue-hashed avatar pill for agent aliases. Same alias → same color across
 *  every page (Messages, Nodes, TopoGraph). Use the `size` prop for inline
 *  pills (16/20) vs card headers (28). Round 21 introduced the palette;
 *  round 22 promotes it from app/messages to a shared component. */

const AVATAR_HUES = [180, 200, 220, 270, 300, 330, 30, 90];

export function aliasAvatarColors(alias?: string | null): { bg: string; ring: string; text: string } {
  // 别让一个缺名字的条目把整页打崩：/settings/networks 曾经因为 network.name
  // 缺失（undefined）在这里读 .length 抛错，整页只剩「This page couldn't load」。
  const name = typeof alias === 'string' ? alias : '';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
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
  // 水合一致性（.441）：头像 URL 来自「localStorage / hub 映射 / 清单文件」，
  // 这些都是浏览器侧的东西 —— 服务端拿不到，只能画首字药丸。
  // 若客户端第一次渲染就画插画，React 会判定文本节点不一致（#418）并整段重渲染。
  // 所以首帧刻意与服务端保持一致（药丸），挂载后再升级成插画。
  // 视觉上不多闪一次：插画清单本来就是异步 fetch，今天也是先药丸后插画。
  // 用 useSyncExternalStore 做「是否已挂载」：服务端快照 false、客户端首帧 false，
  // 订阅后重渲染拿到 true。这是 React 官方推荐的「水合安全」写法
  // （比 useEffect + setState 少一轮级联渲染，也避开 lint 的 cascading-render 规则）。
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [imgState, setImgState] = useState<'loading' | 'ready' | 'error'>('loading');
  // Reset when the url changes — React's endorsed adjust-during-render
  // pattern (no effect, no extra commit).
  const [prevUrl, setPrevUrl] = useState(url);
  if (url !== prevUrl) { setPrevUrl(url); setImgState('loading'); }
  if (mounted && url && imgState !== 'error') {
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
