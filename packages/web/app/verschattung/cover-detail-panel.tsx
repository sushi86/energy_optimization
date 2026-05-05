'use client';
import { useState, useEffect } from 'react';
import type { components } from '@energy-control/shared';

type CoverState = components['schemas']['VerschattungCoverState'];

export interface CoverDetailPanelProps {
  cover: CoverState | null;
  onClose: () => void;
  onSetPosition: (id: string, position: number) => Promise<void>;
  onReleaseOverride: (id: string) => Promise<void>;
}

export function CoverDetailPanel({ cover, onClose, onSetPosition, onReleaseOverride }: CoverDetailPanelProps) {
  const [draftPosition, setDraftPosition] = useState<number>(cover?.currentPosition ?? 100);

  useEffect(() => {
    if (cover?.currentPosition != null) setDraftPosition(cover.currentPosition);
  }, [cover?.id, cover?.currentPosition]);

  if (!cover) return null;

  const stateBadge =
    cover.state === 'OVERRIDE'        ? <span className="text-yellow-400">Override</span> :
    cover.state === 'CLOSED_BY_AUTO'  ? <span className="text-[var(--accent)]">Auto</span> :
                                        <span className="text-[var(--text-secondary)]">Idle</span>;

  return (
    <div className="md:static fixed inset-x-0 bottom-0 z-30 md:z-auto bg-[var(--bg-card)] border-t md:border md:rounded-xl border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold">{cover.label}</h3>
          <p className="text-xs text-[var(--text-secondary)]">Zone: {cover.zone.toUpperCase()} · Status: {stateBadge}</p>
        </div>
        <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="schließen">×</button>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-3">
          <input
            type="range" min={0} max={100} step={1}
            value={draftPosition}
            onChange={(e) => setDraftPosition(Number(e.target.value))}
            onMouseUp={() => onSetPosition(cover.id, draftPosition)}
            onTouchEnd={() => onSetPosition(cover.id, draftPosition)}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="tabular-nums w-12 text-right">{draftPosition}%</span>
        </div>
      </div>

      {cover.lastEvent && (
        <div className="text-xs text-[var(--text-secondary)] mb-3">
          <span className="text-[var(--text-primary)]">Letztes Event:</span>{' '}
          {new Date(cover.lastEvent.ts!).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} —{' '}
          {cover.lastEvent.source === 'auto' ? 'Automation' : cover.lastEvent.source === 'user' ? 'manuell' : 'Reset'}
          {cover.lastEvent.toPosition != null ? `: auf ${cover.lastEvent.toPosition}%` : ''}
          {cover.lastEvent.reason ? ` (${cover.lastEvent.reason})` : ''}
        </div>
      )}

      {cover.state === 'OVERRIDE' && (
        <button
          onClick={() => onReleaseOverride(cover.id)}
          className="px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-card-hover)] hover:bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30"
        >
          Auf Auto setzen
        </button>
      )}
    </div>
  );
}
