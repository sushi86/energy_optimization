'use client';
import { useState } from 'react';
import type { components } from '@energy-control/shared';

type Decision = components['schemas']['VerschattungDecision'];

export function DecisionLog({ decisions }: { decisions: Decision[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (decisions.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-secondary)]">
        Noch keine Entscheidungen geloggt.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] divide-y divide-[var(--border)]">
      <h3 className="text-sm font-semibold px-4 py-3">Decision-Log</h3>
      {decisions.map((d, i) => {
        const key = `${d.appliedAt}-${d.coverId}-${i}`;
        const open = expanded.has(key);
        const time = new Date(d.appliedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const actionColor =
          d.action === 'close' ? 'text-yellow-400' :
          d.action === 'open'  ? 'text-[var(--accent)]' :
                                  'text-[var(--text-secondary)]';
        return (
          <div key={key} className="px-4 py-2 text-sm">
            <button
              onClick={() => toggle(key)}
              className="w-full flex items-start gap-3 text-left hover:bg-[var(--bg-card-hover)] -mx-4 px-4 py-1 cursor-pointer"
              aria-expanded={open}
            >
              <span className="text-xs text-[var(--text-secondary)] w-12 tabular-nums shrink-0">{time}</span>
              <span className="text-xs uppercase w-12 shrink-0">{d.zone}</span>
              <span className={`text-xs shrink-0 w-12 ${actionColor}`}>{d.action}</span>
              <span className="text-[var(--text-secondary)]">{d.reason}</span>
            </button>
            {open && (
              <ul className="mt-2 pl-24 space-y-1 text-xs">
                {d.evaluatedConditions.map((c, j) => (
                  <li key={j}>
                    <span className={c.ok ? 'text-[var(--accent)]' : 'text-yellow-400'}>{c.ok ? '☑' : '☐'}</span>{' '}
                    <span className="text-[var(--text-primary)]">{c.name}</span>{' '}
                    <span className="text-[var(--text-secondary)]">— {c.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
