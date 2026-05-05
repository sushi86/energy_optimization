'use client';
import { useState } from 'react';
import { FloorPlanEg } from './floor-plan-eg';
import { FloorPlanOg } from './floor-plan-og';
import { CoverShape } from './cover-shape';
import { SunIndicator } from './sun-indicator';
import { CoverDetailPanel } from './cover-detail-panel';
import { useVerschattung } from '../../hooks/use-verschattung';

const SVG_COORDS: Record<string, { x: number; y: number; side: 'N'|'S'|'E'|'W'; widthMm: number }> = {
  'cover.eingang_rolladen':            { x: 100, y: 600, side: 'E', widthMm: 1000 },
  'cover.kuche_vorn_rolladen':         { x: 100, y: 200, side: 'E', widthMm: 1500 },
  'cover.kuche_garten_rolladen':       { x: 250, y:  50, side: 'N', widthMm: 1500 },
  'cover.galerie_rolladen':            { x: 500, y:  50, side: 'N', widthMm: 2700 },
  'cover.shellyplus2pm_cc7b5c0f3484':  { x: 700, y:  50, side: 'N', widthMm: 1100 },
  'cover.shellyplus2pm_e465b8f35e50':  { x: 850, y:  50, side: 'N', widthMm: 1100 },
  'cover.westen_gross_rolladen':       { x: 950, y: 400, side: 'W', widthMm: 2400 },
  'cover.west_klein_rolladen':         { x: 950, y: 250, side: 'W', widthMm: 1100 },
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

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h2 className="text-sm text-[var(--text-secondary)] mb-2">Erdgeschoss</h2>
        <FloorPlanEg>
          {state && <SunIndicator azimuthDeg={state.inputs.sun.azimuthDeg} elevationDeg={state.inputs.sun.elevationDeg} />}
          {coversByFloor('EG').map((c) => {
            const coord = SVG_COORDS[c.id];
            if (!coord) return null;
            return (
              <CoverShape key={c.id} cover={c} svg={coord}
                onClick={() => setSelectedId(c.id)}
                selected={c.id === selectedId} />
            );
          })}
        </FloorPlanEg>
      </div>

      <div>
        <h2 className="text-sm text-[var(--text-secondary)] mb-2">Obergeschoss</h2>
        <FloorPlanOg>
          {coversByFloor('OG').map((c) => {
            const coord = SVG_COORDS[c.id];
            if (!coord) return null;
            return (
              <CoverShape key={c.id} cover={c} svg={coord}
                onClick={() => setSelectedId(c.id)}
                selected={c.id === selectedId} />
            );
          })}
        </FloorPlanOg>
      </div>

      <CoverDetailPanel
        cover={selected}
        onClose={() => setSelectedId(null)}
        onSetPosition={setPosition}
        onReleaseOverride={releaseOverride}
      />
    </div>
  );
}
