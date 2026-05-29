'use client';
import { useState } from 'react';
import { FloorPlanEg } from './floor-plan-eg';
import { FloorPlanOg } from './floor-plan-og';
import { CoverShape } from './cover-shape';
import { StaticWindow } from './static-window';
import { SunIndicator } from './sun-indicator';
import { CoverPopover } from './cover-popover';
import { RoomTempBadge } from './room-temp-badge';
import { useVerschattung } from '../../hooks/use-verschattung';

// SVG-Koordinaten (mm) — Spiegelung aus packages/api/src/verschattung/covers.ts.
// ViewBox des Plans ist 0..13120 × 0..9970 (mit 700 mm Außenpadding).
const SVG_COORDS: Record<string, { x: number; y: number; side: 'N'|'S'|'E'|'W'; widthMm: number }> = {
  // EG OST
  'cover.kuche_vorn_rolladen':         { x: 0,     y: 1100, side: 'E', widthMm: 1450 },
  'cover.eingang_rolladen':            { x: 0,     y: 6300, side: 'E', widthMm: 1100 },
  // EG SÜD
  'cover.kuche_garten_rolladen':       { x: 1700,  y: 0,    side: 'N', widthMm: 1980 },
  'cover.galerie_rolladen':            { x: 5800,  y: 0,    side: 'N', widthMm: 2730 },
  'cover.shellyplus2pm_cc7b5c0f3484':  { x: 9400,  y: 0,    side: 'N', widthMm: 1105 },
  'cover.shellyplus2pm_e465b8f35e50':  { x: 11400, y: 0,    side: 'N', widthMm: 1100 },
  // EG WEST
  'cover.west_klein_rolladen':         { x: 13120, y: 1900, side: 'W', widthMm: 1100 },
  'cover.westen_gross_rolladen':       { x: 13120, y: 4800, side: 'W', widthMm: 2350 },
  // OG OST
  'cover.ankleide_rolladen':           { x: 0,     y: 5400, side: 'E', widthMm: 605  },
  'cover.schlafzimmer_rolladen':       { x: 0,     y: 7700, side: 'E', widthMm: 1105 },
  // OG WEST
  'cover.paul_rolladen':               { x: 13120, y: 2400, side: 'W', widthMm: 1730 },
  'cover.emil_rolladen':               { x: 13120, y: 7400, side: 'W', widthMm: 1730 },
};

const STATIC_WINDOWS_OG = [
  { id: 'og-buero-fluchtfenster',  svg: { x: 0, y: 2400, side: 'E' as const, widthMm: 1480 }, label: 'Büro Fluchtfenster' },
  { id: 'og-luftraum-lichtband',   svg: { x: 5200, y: 0, side: 'N' as const, widthMm: 2730 }, label: 'Luftraum-Lichtband (FIX)' },
];

// Raum-Badge-Positionen (mm). Spiegelung aus packages/api/src/verschattung/rooms.ts.
const ROOM_POS: Record<string, { x: number; y: number }> = {
  eg:       { x: 2200,  y: 5200 },
  og_buero: { x: 2090,  y: 2900 },
  og_paul:  { x: 10945, y: 3100 },
  og_emil:  { x: 10945, y: 8500 },
};

export function ManualTab() {
  const { state } = useVerschattung();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setPosition = async (id: string, position: number) => {
    await fetch(`/api/verschattung/cover/${encodeURIComponent(id)}/position`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ position }),
    });
  };
  const releaseOverride = async (id: string) => {
    await fetch(`/api/verschattung/cover/${encodeURIComponent(id)}/auto`, { method: 'POST' });
  };

  const selected = state?.covers.find((c) => c.id === selectedId) ?? null;
  const coversByFloor = (floor: 'EG' | 'OG') => state?.covers.filter((c) => c.floor === floor) ?? [];
  const roomsByFloor = (floor: 'EG' | 'OG') => state?.rooms?.filter((r) => r.floor === floor) ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h2 className="text-sm text-[var(--text-secondary)] mb-2">Erdgeschoss</h2>
        <div className="relative">
          <FloorPlanEg>
            {state && <SunIndicator azimuthDeg={state.inputs.sun.azimuthDeg} elevationDeg={state.inputs.sun.elevationDeg} />}
            {coversByFloor('EG').map((c) => {
              const coord = SVG_COORDS[c.id];
              if (!coord) return null;
              return (
                <CoverShape key={c.id} cover={c} svg={coord}
                  onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                  selected={c.id === selectedId} />
              );
            })}
            {roomsByFloor('EG').map((r) => {
              const pos = ROOM_POS[r.id];
              if (!pos) return null;
              return <RoomTempBadge key={r.id} x={pos.x} y={pos.y} tempC={r.tempC} humidity={r.humidity} />;
            })}
          </FloorPlanEg>
          {selected && selected.floor === 'EG' && SVG_COORDS[selected.id] && (
            <CoverPopover
              cover={selected}
              svg={SVG_COORDS[selected.id]!}
              onClose={() => setSelectedId(null)}
              onSetPosition={setPosition}
              onReleaseOverride={releaseOverride}
            />
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm text-[var(--text-secondary)] mb-2">Obergeschoss</h2>
        <div className="relative">
          <FloorPlanOg>
            {STATIC_WINDOWS_OG.map((w) => (
              <StaticWindow key={w.id} svg={w.svg} label={w.label} />
            ))}
            {coversByFloor('OG').map((c) => {
              const coord = SVG_COORDS[c.id];
              if (!coord) return null;
              return (
                <CoverShape key={c.id} cover={c} svg={coord}
                  onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                  selected={c.id === selectedId} />
              );
            })}
            {roomsByFloor('OG').map((r) => {
              const pos = ROOM_POS[r.id];
              if (!pos) return null;
              return <RoomTempBadge key={r.id} x={pos.x} y={pos.y} tempC={r.tempC} humidity={r.humidity} />;
            })}
          </FloorPlanOg>
          {selected && selected.floor === 'OG' && SVG_COORDS[selected.id] && (
            <CoverPopover
              cover={selected}
              svg={SVG_COORDS[selected.id]!}
              onClose={() => setSelectedId(null)}
              onSetPosition={setPosition}
              onReleaseOverride={releaseOverride}
            />
          )}
        </div>
      </div>
    </div>
  );
}
