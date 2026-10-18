'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNetworkId } from '../lib/network-context';
import { PendingNotice } from '../components/PendingNotice';
import { TaskCard } from '../components/requirement-chrome';
import { OrgTree, type AgentOrgData } from './OrgTree';

type NodeRef = { node_id?: string; alias?: string | null; display_name?: string | null };
type Team = {
  id: string;
  name: string;
  parent_id?: string | null;
  lead?: NodeRef | null;
  owner?: { user_id?: string; display_name?: string } | null;
  members?: NodeRef[];
};

type OrgResult = { status: 'ready'; data: AgentOrgData } | { status: 'missing' } | { status: 'error'; error?: string };

function labelOf(node?: NodeRef | null): string {
  if (!node) return '';
  return node.display_name || node.alias || node.node_id || '';
}

export default function TeamsPage() {
  const { networkId } = useNetworkId();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [org, setOrg] = useState<OrgResult | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

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
        if (body.error && !body.teams && !body.org) {
          setError(typeof body.error === 'string' ? body.error : '读取组织失败');
          setTeams([]);
          setOrg({ status: 'error', error: typeof body.error === 'string' ? body.error : '读取组织失败' });
          return;
        }
        const teamBody = body.teams;
        if (teamBody && teamBody.ok === false) setError(typeof teamBody.error === 'string' ? teamBody.error : '读取 Agent 团队失败');
        else setError('');
        setTeams(Array.isArray(teamBody?.teams) ? teamBody.teams : []);
        const next = body.org;
        if (next && next.status === 'ready' && next.data) setOrg({ status: 'ready', data: next.data });
        else if (next && next.status === 'missing') setOrg({ status: 'missing' });
        else setOrg({ status: 'error', error: typeof next?.error === 'string' ? next.error : '组织架构没有读到，请重试' });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const message = e instanceof Error ? e.message : '读取组织失败';
        setError(message);
        setTeams([]);
        setOrg({ status: 'error', error: message });
      });
    return () => { alive = false; };
  }, [attempt, networkId, router]);

  const byId = new Map((teams || []).map((team) => [team.id, team]));

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-6 text-[var(--fg)] sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold leading-7">组织架构</h1>
            <PendingNotice>
              新建部门、改上级和指定负责人还在 Hub 上改。这里的「模拟调整」只改这一页的显示。
            </PendingNotice>
          </div>
          <p className="max-w-xl text-xs leading-4 text-[var(--fg-dim)]">
            点开部门查看里面的 Agent。人数含下级。未归属是没有部门的负责人，或没有负责人的 Agent。
          </p>
        </header>
        {org === null ? <p className="text-sm text-[var(--fg-dim)]">正在读取组织架构…</p> : null}
        {org?.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-[var(--danger)]">{org.error || '组织架构没有读到，请重试'}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="inline-flex h-8 items-center rounded-[10px] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--fg)]">重试</button>
          </div>
        ) : null}
        {org?.status === 'missing' ? <p className="text-sm text-[var(--fg-muted)]">这个 Hub 还没有部门树，也没有人员通讯录。</p> : null}
        {org?.status === 'ready' ? <OrgTree key={networkId || 'default'} data={org.data} /> : null}

        <section className="space-y-2">
          <h2 className="text-sm font-medium">Agent 团队</h2>
          <p className="text-[11px] text-[var(--fg-dim)]">团队是另一棵树，和上面的部门不是同一份数据。</p>
          {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
          {teams && teams.length === 0 ? <p className="text-sm text-[var(--fg-dim)]">这个网络还没有 Agent 团队。</p> : null}
          <ul className="space-y-2">
            {(teams || []).map((team) => (
              <li key={team.id}>
                <TaskCard>
                  <div className="text-sm font-medium">
                    {team.name}
                    {team.parent_id ? <span className="ml-2 font-normal text-[var(--fg-dim)]">上级 {byId.get(team.parent_id)?.name || ''}</span> : null}
                  </div>
                  <div className="mt-1 text-xs text-[var(--fg-dim)]">
                    {team.lead ? `组长 ${labelOf(team.lead)}` : '没有组长'}
                    {team.owner?.display_name ? ` · 负责人 ${team.owner.display_name}` : ''}
                  </div>
                  {(team.members || []).length > 0 ? (
                    <div className="mt-1 text-xs text-[var(--fg-muted)]">
                      {(team.members || []).map((member) => labelOf(member)).filter(Boolean).join('、')}
                    </div>
                  ) : null}
                </TaskCard>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
