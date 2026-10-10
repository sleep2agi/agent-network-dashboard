'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNetworkId } from '../lib/network-context';
import { PendingNotice } from '../components/PendingNotice';

type NodeRef = { node_id?: string; alias?: string | null; display_name?: string | null };
type Team = {
  id: string;
  name: string;
  parent_id?: string | null;
  lead?: NodeRef | null;
  owner?: { user_id?: string; display_name?: string } | null;
  members?: NodeRef[];
};
type Department = { id: string; name: string; parent_id?: string | null };

function labelOf(node?: NodeRef | null): string {
  if (!node) return '';
  return node.display_name || node.alias || node.node_id || '';
}

export default function TeamsPage() {
  const { networkId } = useNetworkId();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState('');
  const [deptError, setDeptError] = useState('');

  useEffect(() => {
    let alive = true;
    const qs = networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';
    fetch(`/api/hub/org${qs}`, { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          router.push('/login');
          return null;
        }
        return r.json();
      })
      .then((body) => {
        if (!alive || !body) return;
        if (body.error && !body.teams && !body.departments) {
          setError(body.error);
          setTeams([]);
          setDepartments([]);
          return;
        }
        const teamBody = body.teams;
        const deptBody = body.departments;
        if (teamBody && teamBody.ok === false) setError(typeof teamBody.error === 'string' ? teamBody.error : '读取 Agent 团队失败');
        else setError('');
        if (deptBody && deptBody.ok === false) setDeptError(typeof deptBody.error === 'string' ? deptBody.error : '读取部门失败');
        else setDeptError('');
        setTeams(Array.isArray(teamBody?.teams) ? teamBody.teams : []);
        setDepartments(Array.isArray(deptBody?.departments) ? deptBody.departments : []);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : '读取组织失败');
        setTeams([]);
        setDepartments([]);
      });
    return () => { alive = false; };
  }, [networkId, router]);

  const roots = (teams || []).filter((team) => !team.parent_id);

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-5 text-[var(--fg)] sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold">Agent 组织</h1>
          <p className="text-xs text-[var(--fg-muted)]">
            Agent 团队和人的部门是两棵树。这里只读 Hub 已经存的结构。
          </p>
        </header>
        <PendingNotice>
          新建团队、调整上级、指定组长还没接到。空列表表示 Hub 没返回团队，不是占位数据。
        </PendingNotice>
        {teams === null ? <p className="text-xs text-[var(--fg-dim)]">正在读取…</p> : null}
        {error ? <p className="text-xs text-red-300">{error}</p> : null}
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Agent 团队</h2>
          {teams && teams.length === 0 ? <p className="text-xs text-[var(--fg-dim)]">这个网络还没有 Agent 团队。</p> : null}
          <ul className="space-y-2">
            {(teams || []).map((team) => (
              <li key={team.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs">
                <div className="font-medium">
                  {team.name}
                  {team.parent_id ? <span className="ml-2 font-normal text-[var(--fg-dim)]">上级 {roots.find((item) => item.id === team.parent_id)?.name || (teams || []).find((item) => item.id === team.parent_id)?.name || ''}</span> : null}
                </div>
                <div className="mt-1 text-[var(--fg-dim)]">
                  {team.lead ? `组长 ${labelOf(team.lead)}` : '没有组长'}
                  {team.owner?.display_name ? ` · 负责人 ${team.owner.display_name}` : ''}
                </div>
                {(team.members || []).length > 0 ? (
                  <div className="mt-1 text-[var(--fg-muted)]">
                    {(team.members || []).map((member) => labelOf(member)).filter(Boolean).join('、')}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium">人的部门</h2>
          {deptError ? <p className="text-xs text-red-300">{deptError}</p> : null}
          {!deptError && departments && departments.length === 0 ? <p className="text-xs text-[var(--fg-dim)]">还没有部门。</p> : null}
          <ul className="space-y-1">
            {(departments || []).map((dept) => (
              <li key={dept.id} className="text-xs text-[var(--fg-muted)]">{dept.name}</li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
