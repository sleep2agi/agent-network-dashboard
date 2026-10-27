'use client';

/**
 * /topology3d —— 军团拓扑的等距平台版本（新模块）。
 * 2D 版（首页 TopoGraph）保持不动，两者并存。
 *
 * 数据源与首页一致：useSessions()（/api/status 的 sessions），
 * 不新增接口、不改后端。
 */

import { useSessions } from '../lib/hooks';
import { TopoGraph3D } from '../components/TopoGraph3D';

export default function Topology3DPage() {
  const { sessions, isLoading, error } = useSessions();

  if (isLoading && !sessions.length) {
    return <div className="flex h-[calc(100vh-56px)] items-center justify-center text-sm text-gray-500">加载中…</div>;
  }
  if (error) {
    return <div className="flex h-[calc(100vh-56px)] items-center justify-center text-sm text-red-500">读取失败：{String(error)}</div>;
  }
  return <TopoGraph3D sessions={sessions} />;
}
