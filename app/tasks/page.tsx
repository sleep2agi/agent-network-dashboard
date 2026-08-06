'use client';

// #Stage-tasks: /tasks entry point. Thin wrapper — the whole layout
// lives in TasksView so /tasks and /tasks/[id] share the same code
// path (only diff: [id] page passes an initialSelectedId that seeds
// the deep-link selection).
//
// The 21.5KB one-big-table + inline-expand + TaskDrawer implementation
// that used to live here is replaced by the list+detail layout — see
// TasksView.tsx header comment for the design rationale.

import { TasksView } from './TasksView';

export default function TasksPage() {
  return <TasksView />;
}
