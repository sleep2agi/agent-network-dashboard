'use client';

import { use } from 'react';
import { NodesView, decodeAliasSegment } from '../NodesView';

// #Stage B: shareable deep link — /nodes/<alias> opens the node list with
// that node's conversation already selected in the right pane (or the
// full-screen overlay below md). Client component on purpose: NodesView is
// a client module, so its exports (decodeAliasSegment) are client
// references — calling one from a server component crashes the render
// ("Attempted to call … from the server", caught by the deep-link e2e).
// The segment is decoded exactly once (aliases are routinely Chinese →
// percent-encoded; see the double-decode note on the helper).
export default function NodeAliasPage({ params }: { params: Promise<{ alias: string }> }) {
  const { alias } = use(params);
  return <NodesView initialAlias={decodeAliasSegment(alias)} />;
}
