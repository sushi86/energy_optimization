import type { ReactNode } from 'react';

export interface FloorPlanProps {
  children?: ReactNode;
}

// EG-Außenmaß laut Architekten-Plan: 13120 mm × 9970 mm.
// Konvention: oben = SÜD, unten = NORD, links = OST, rechts = WEST.
export function FloorPlanEg({ children }: FloorPlanProps) {
  const wall = 'stroke-[var(--text-secondary)] fill-none';
  const interior = 'stroke-[var(--border)] fill-none';
  const label = 'fill-[var(--text-secondary)]';
  const compass = 'fill-[var(--text-secondary)] opacity-60';

  return (
    <svg viewBox="-700 -700 14520 11370" className="w-full h-auto" role="img" aria-label="Grundriss Erdgeschoss">
      {/* Außenwand */}
      <rect x={0} y={0} width={13120} height={9970}
        className={wall} strokeWidth={80} />

      {/* Innenwände (vereinfacht — entspricht den raumtrennenden Wänden des Architekten-Plans) */}
      <g className={interior} strokeWidth={40}>
        {/* Vertikale Wand: Diele/Küche → Flur/Essen */}
        <line x1={4500} y1={0}    x2={4500} y2={9970} />
        {/* Vertikale Wand: Flur/Zimmer → Wohnen */}
        <line x1={8770} y1={0}    x2={8770} y2={9970} />
        {/* Horizontale Wand: Küche/Diele */}
        <line x1={0}    y1={3500} x2={4500} y2={3500} />
        {/* Horizontale Wand: Essen/Flur */}
        <line x1={4500} y1={4000} x2={8770} y2={4000} />
        {/* Horizontale Wand: Diele/WC, Flur/Zimmer */}
        <line x1={0}    y1={6900} x2={8770} y2={6900} />
        {/* Vertikale Wand: WC/Zimmer */}
        <line x1={3000} y1={6900} x2={3000} y2={9970} />
      </g>

      {/* Raumbeschriftungen */}
      <g className={label} fontSize={300} textAnchor="middle">
        <text x={2250}  y={1850}>Küche</text>
        <text x={6635}  y={2100}>Essen</text>
        <text x={10945} y={4985}>Wohnen</text>
        <text x={2250}  y={5300}>Diele</text>
        <text x={6635}  y={5550}>Flur</text>
        <text x={1500}  y={8500}>WC</text>
        <text x={5885}  y={8500}>Zimmer</text>
      </g>

      {/* Kompass */}
      <g className={compass} fontSize={280} textAnchor="middle">
        <text x={6560} y={-300}>SÜD</text>
        <text x={6560} y={10500}>NORD</text>
        <text x={-300} y={5050}>OST</text>
        <text x={13420} y={5050}>WEST</text>
      </g>

      {children}
    </svg>
  );
}
