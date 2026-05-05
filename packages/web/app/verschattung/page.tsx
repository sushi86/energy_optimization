'use client';
import { useState } from 'react';
import { Blinds } from 'lucide-react';
import { ManualTab } from './manual-tab';
import { AutomationTab } from './automation-tab';

export default function VerschattungPage() {
  const [tab, setTab] = useState<'manual' | 'automation'>('manual');

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Blinds size={28} className="text-[var(--accent)]" />
          <h1 className="text-2xl font-bold tracking-tight">Verschattung</h1>
        </div>
      </header>

      <div className="flex gap-2 mb-6 border-b border-[var(--border)]">
        <TabButton active={tab === 'manual'}      onClick={() => setTab('manual')}>Manuell</TabButton>
        <TabButton active={tab === 'automation'}  onClick={() => setTab('automation')}>Automation</TabButton>
      </div>

      {tab === 'manual'     ? <ManualTab />     : null}
      {tab === 'automation' ? <AutomationTab /> : null}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
        active
          ? 'border-[var(--accent)] text-[var(--accent)]'
          : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}
