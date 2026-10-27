/**
 * 军团两页（2D `/legion`、3D `/legion/3d`）共用的取数口径。
 *
 * 这里单独抽出来的原因：两页只要有一条 fetch 语义不一致，就会出现
 * 「2D 说 Hub 没有部门树、3D 说加载失败」这种自相矛盾的画面。所以：
 *   - `/api/hub/people` 非 ok 一律抛（带状态码），401 交给统一登录提示；
 *   - `/api/hub/departments` 的 404 是**能力缺失**（老 Hub 没有这条路由），
 *     返回 null 让页面回退到扁平分组；其余非 2xx 仍然抛。
 */

import type { LegionPerson, LegionAgentRef, LegionDepartment, LegionMember } from './legion-layout';

export interface PeopleResponse {
  ok: boolean;
  total: number;
  people: LegionPerson[];
  agents_without_owner?: LegionAgentRef[];
  has_more: boolean;
}

export interface DepartmentsResponse {
  departments?: LegionDepartment[];
  members?: LegionMember[];
}

export interface StatusResponse {
  sessions?: { alias: string; status: string; node_id?: string }[];
}

const unauthorized = () => Object.assign(new Error('unauthorized'), { status: 401 });

export const legionFetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 401) throw unauthorized();
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw Object.assign(new Error(json?.error || `hub_${res.status}`), { status: res.status });
  }
  return json;
};

export const deptFetcher = async (url: string): Promise<DepartmentsResponse | null> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (res.status === 401) throw unauthorized();
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw Object.assign(new Error(json?.error || `hub_${res.status}`), { status: res.status });
  }
  return json as DepartmentsResponse;
};
