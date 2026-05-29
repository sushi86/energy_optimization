'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { components } from '@energy-control/shared';

type CoverState = components['schemas']['VerschattungCoverState'];

// ViewBox des Grundriss-SVG (Spiegelung aus floor-plan-eg.tsx / floor-plan-og.tsx).
const VIEWBOX = { x: -700, y: -700, w: 14520, h: 11370 };

export interface CoverPopoverProps {
  cover: CoverState;
  svg: { x: number; y: number; side: 'N' | 'S' | 'E' | 'W'; widthMm: number };
  onClose: () => void;
  onSetPosition: (id: string, position: number) => Promise<void>;
  onReleaseOverride: (id: string) => Promise<void>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return `vor ${s} Sekunde${s === 1 ? '' : 'n'}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m} ${m === 1 ? 'Minute' : 'Minuten'}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} ${h === 1 ? 'Stunde' : 'Stunden'}`;
  const d = Math.floor(h / 24);
  return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}

function popoverPosition(side: 'N' | 'S' | 'E' | 'W', x: number, y: number): CSSProperties {
  const relX = ((x - VIEWBOX.x) / VIEWBOX.w) * 100;
  const relY = ((y - VIEWBOX.y) / VIEWBOX.h) * 100;
  switch (side) {
    case 'N':
      return { top: '4%',    left: `${relX}%`, transform: 'translateX(-50%)' };
    case 'S':
      return { bottom: '4%', left: `${relX}%`, transform: 'translateX(-50%)' };
    case 'E':
      return { left: '4%',   top:  `${relY}%`, transform: 'translateY(-50%)' };
    case 'W':
      return { right: '4%',  top:  `${relY}%`, transform: 'translateY(-50%)' };
  }
}

export function CoverPopover({ cover, svg, onClose, onSetPosition, onReleaseOverride }: CoverPopoverProps) {
  const [draft, setDraft] = useState<number>(cover.currentPosition ?? 100);
  const dragging = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (cover.currentPosition != null && !dragging.current) setDraft(cover.currentPosition);
  }, [cover.id, cover.currentPosition]);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const updateFromY = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = clamp(((clientY - r.top) / r.height) * 100, 0, 100);
    setDraft(Math.round(pct));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    updateFromY(e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    updateFromY(e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    void onSetPosition(cover.id, draft);
  };

  const stateLabel =
    cover.state === 'OVERRIDE'       ? 'Override' :
    cover.state === 'CLOSED_BY_AUTO' ? 'Automation' :
                                       'Idle';
  const stateColor =
    cover.state === 'OVERRIDE'       ? 'var(--warning, #f59e0b)' :
    cover.state === 'CLOSED_BY_AUTO' ? 'var(--accent)'           :
                                       'var(--text-secondary)';

  const ev = cover.lastEvent;
  const sourceLabel =
    ev?.source === 'auto'  ? 'Automation' :
    ev?.source === 'user'  ? 'Manuell'    :
    ev?.source === 'reset' ? 'Reset'      : null;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        zIndex: 10,
        width: 'min(320px, 88%)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 16,
        boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
        color: 'var(--text-primary)',
        ...popoverPosition(svg.side, svg.x, svg.y),
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cover.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Zone {cover.zone.toUpperCase()}</span>
            <span style={{ color: stateColor, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: stateColor }} />
              {stateLabel}
            </span>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="schließen"
          style={{
            flexShrink: 0,
            width: 30, height: 30,
            borderRadius: 999,
            background: 'var(--bg-card-hover)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: 17,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >×</button>
      </div>

      <div style={{ height: 1, background: 'var(--border)', margin: '14px 0' }} />

      {/* Body: Slider | Info */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        {/* Vertikaler Slider */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: 0.8 }}>offen</div>
          <div
            ref={trackRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              position: 'relative',
              width: 70,
              height: 220,
              touchAction: 'none',
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
            {/* Track */}
            <div style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              top: 0, bottom: 0, width: 22, borderRadius: 11,
              background: 'var(--bg-card-hover)',
              border: '1px solid var(--border)',
            }} />
            {/* Füllung von oben bis Thumb */}
            <div style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              top: 0, height: `${draft}%`, width: 22, borderRadius: 11,
              background: 'var(--accent)', opacity: 0.55,
              pointerEvents: 'none',
            }} />
            {/* Thumb */}
            <div style={{
              position: 'absolute', left: '50%', top: `${draft}%`,
              transform: 'translate(-50%, -50%)',
              width: 60, height: 34, borderRadius: 17,
              background: 'var(--accent)',
              boxShadow: '0 3px 8px rgba(0,0,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--bg-primary)', fontWeight: 700, fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
            }}>
              {draft}%
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: 0.8 }}>zu</div>
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1.3, color: 'var(--text-secondary)' }}>
            LETZTE AKTION
          </div>
          {ev && (ev.reason || ev.ts || sourceLabel) ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 5, lineHeight: 1.2 }}>
                {sourceLabel ?? '—'}
                {ev.toPosition != null && (
                  <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 6 }}>
                    → {ev.toPosition}%
                  </span>
                )}
              </div>
              {ev.ts && (
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {relTime(ev.ts)}
                </div>
              )}
              {ev.reason && (
                <div style={{ fontSize: 12.5, lineHeight: 1.4, marginTop: 9, color: 'var(--text-primary)' }}>
                  {ev.reason}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6 }}>
              Noch keine Automations-Aktion.
            </div>
          )}
        </div>
      </div>

      {/* Footer-Button */}
      {cover.state === 'OVERRIDE' && (
        <button
          onClick={(e) => { e.stopPropagation(); void onReleaseOverride(cover.id); }}
          style={{
            marginTop: 14,
            width: '100%',
            padding: '10px 14px',
            borderRadius: 10,
            background: 'var(--accent)',
            color: 'var(--bg-primary)',
            border: 'none',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Auf Automation zurücksetzen
        </button>
      )}
    </div>
  );
}
