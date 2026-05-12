'use client';

import { InboxMessage } from './types';
import { AliasAvatar } from './AliasAvatar';
import { timeAgo } from './utils';

interface InboxPanelProps {
  messages: InboxMessage[];
}

export function InboxPanel({ messages }: InboxPanelProps) {
  if (messages.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
        <span className="text-gray-500">Inbox</span>
        <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded-full border border-blue-800/30">
          {messages.length}
        </span>
      </h2>
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
        {messages.map(m => (
          <div key={m.id} className="bg-[#111128] border border-[#2a2a4a] rounded-lg px-4 py-3 text-sm transition-colors hover:border-[#3a3a5a]">
            <div className="flex items-center gap-2 text-xs mb-1.5">
              {m.from_session && <AliasAvatar alias={m.from_session} size={16} />}
              <span className="text-gray-200 font-medium truncate">{m.from_session}</span>
              <span className="ml-auto text-gray-600 shrink-0" title={m.created_at}>{timeAgo(m.created_at)}</span>
            </div>
            <div className="text-gray-300 leading-relaxed">{m.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
