'use client';
import type { components } from '@energy-control/shared';
import { useState } from 'react';

type State = components['schemas']['VerschattungStateResponse'];

export function ZoneEvaluation({ state }: { state: State }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const zones: ('ost' | 'sued' | 'west')[] = ['ost', 'sued', 'west'];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] divide-y divide-[var(--border)]">
      <h3 className="text-sm font-semibold px-4 py-3">Zonen-Bewertung</h3>
      {zones.map((z) => {
        const covers = state.covers.filter((c) => c.zone === z);
        const closed = covers.filter((c) => c.state === 'CLOSED_BY_AUTO').length;
        const overrides = covers.filter((c) => c.state === 'OVERRIDE').length;
        return (
          <div key={z} className="px-4 py-2 text-sm">
            <button
              onClick={() => setOpen((s) => ({ ...s, [z]: !s[z] }))}
              className="w-full flex justify-between items-center hover:bg-[var(--bg-card-hover)] -mx-4 px-4 py-1 cursor-pointer"
              aria-expanded={!!open[z]}
            >
              <span className="font-medium uppercase">{z}</span>
              <span className="text-[var(--text-secondary)] text-xs">
                {closed}/{covers.length} zu{overrides > 0 ? `, ${overrides} Override` : ''}
              </span>
            </button>
            {open[z] && (
              <ul className="mt-2 pl-3 space-y-1 text-xs">
                {covers.map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>{c.label}</span>
                    <span className="text-[var(--text-secondary)]">
                      {c.currentPosition != null ? `${c.currentPosition}%` : '—'} · {c.state}
                    </span>
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
