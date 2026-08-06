'use client';

import { NodesView } from './NodesView';

// #Stage B: /nodes with no alias segment = nothing selected. The page body
// lives in NodesView so /nodes and /nodes/[alias] render the same component
// (selection is state + shallow pushState, not a route remount).
export default function NodesPage() {
  return <NodesView />;
}
