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

type LegionReadError = Error & { status?: number };

/** 多路编制读取共用错误呈现；任一路登录失效都优先显示重新登录。 */
export function legionReadError(...errors: (LegionReadError | undefined)[]): LegionReadError | undefined {
  return errors.find(error => error?.status === 401) ?? errors.find(error => error != null);
}

/**
 * #1636-P1 —— 把当前网络拼进请求 URL。
 *
 * 为什么必须在 **URL/SWR key** 上拼，而不是在 fetcher 里偷偷加参数：
 * SWR 的缓存按 key 存。只要 key 不含网络，切网之后拿到的还是上一个网络的缓存，
 * 页面会「看起来没变」；拼进 key 之后，切网 = 换 key = 重新取数 = 不会串数据。
 *
 * networkId 为空（还没解析出来）时原样返回，保持与旧行为一致。
 */
export function scopedUrl(url: string, networkId: string | null | undefined): string {
  if (!networkId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}network_id=${encodeURIComponent(networkId)}`;
}

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
