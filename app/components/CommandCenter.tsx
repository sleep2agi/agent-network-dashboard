'use client';

import { useState } from 'react';
import { TaskChatPanel } from './TaskChatPanel';

interface CommandCenterProps {
  /** Currently open chat tabs */
  tabs: string[];
  activeTab: string;
  onOpenTab: (alias: string) => void;
  onCloseTab: (alias: string) => void;
  onSetActive: (alias: string) => void;
  onClose: () => void;
}

/**
 * Multi-tab chat panel for commanding multiple agents simultaneously.
 * Wraps TaskChatPanel with a tab bar for switching between agents.
 */
export function CommandCenter({ tabs, activeTab, onOpenTab, onCloseTab, onSetActive, onClose }: CommandCenterProps) {
  if (tabs.length === 0) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-[100dvh] w-full lg:w-[500px] bg-[#0a0a1a] border-l border-[#2a2a4a] z-50 flex flex-col shadow-2xl shadow-black/60 animate-slide-in">
        {/* Tab bar */}
        <div className="flex items-center border-b border-[#2a2a4a] bg-[#0d0d1a] overflow-x-auto">
          <div className="flex-1 flex min-w-0">
            {tabs.map(alias => (
              <button
                key={alias}
                onClick={() => onSetActive(alias)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs border-b-2 transition-colors shrink-0 ${
                  activeTab === alias
                    ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${activeTab === alias ? 'bg-cyan-400' : 'bg-gray-600'}`} />
                <span className="max-w-[80px] truncate">{alias}</span>
                <button
                  onClick={e => { e.stopPropagation(); onCloseTab(alias); }}
                  className="ml-1 text-gray-600 hover:text-gray-300 p-0.5"
                >
                  ×
                </button>
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white px-3 py-2.5 shrink-0 border-l border-[#2a2a4a]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Active chat - render all but only show active (preserves state) */}
        <div className="flex-1 relative overflow-hidden">
          {tabs.map(alias => (
            <div key={alias} className={`absolute inset-0 ${activeTab === alias ? 'block' : 'hidden'}`}>
              <InlineChat alias={alias} />
            </div>
          ))}
        </div>
      </div>

      <style jsx global>{`
        @keyframes slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slide-in 0.2s ease-out;
        }
      `}</style>
    </>
  );
}

/** Inline chat without the panel chrome (used inside CommandCenter tabs) */
function InlineChat({ alias }: { alias: string }) {
  // Reuse TaskChatPanel's logic but render without the outer frame
  return <TaskChatPanel alias={alias} onClose={() => {}} inline />;
}

/**
 * Hook to manage multi-tab command center state.
 */
export function useCommandCenter() {
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('');

  const openTab = (alias: string) => {
    setTabs(prev => prev.includes(alias) ? prev : [...prev, alias]);
    setActiveTab(alias);
  };

  const closeTab = (alias: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t !== alias);
      if (activeTab === alias) setActiveTab(next[next.length - 1] || '');
      return next;
    });
  };

  const closeAll = () => {
    setTabs([]);
    setActiveTab('');
  };

  return { tabs, activeTab, openTab, closeTab, closeAll, setActiveTab };
}
