'use client';

import { use } from 'react';
import { TasksView, decodeIdSegment } from '../TasksView';

// #Stage-tasks: shareable deep link /tasks/<task_id> opens the list
// with that task's detail pre-selected in the right pane (or the
// full-screen overlay below md).
//
// 🔴 Client component on purpose. TasksView is a client module — its
// exports (decodeIdSegment) are client references. Calling one from
// a server component crashes the render ("Attempted to call … from
// the server"). Same shape as /nodes/[alias]/page.tsx; N站马's first
// version was a server component and got caught by the deep-link
// e2e — do NOT change this to server.
//
// Migration note: the previous /tasks/[id]/page.tsx (181 lines) was
// a standalone full-page detail with its own Timeline + Info + Content
// + Result + Events feed cards. All five have moved into
// components/TaskDetail.tsx so /tasks and /tasks/[id] render the SAME
// detail — no "old page hiding beside the new one" (通信龙 07-31 catch
// from /nodes rendering nodes twice). Deep links to /tasks/[id] still
// work; they land on the two-column layout with the task pre-selected.

export default function TaskIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TasksView initialSelectedId={decodeIdSegment(id)} />;
}
