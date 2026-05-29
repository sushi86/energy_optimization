import type { ReactNode } from 'react';

export interface FloorPlanProps {
  children?: ReactNode;
}

// OG-Außenmaß identisch zum EG (gleiche Hülle, anderes Innenleben).
// Konvention: oben = SÜD, unten = NORD, links = OST, rechts = WEST.
// Räume: Büro (oben links), Pauls Zimmer (oben rechts),
//        Schlafzimmer (unten links), Emils Zimmer (unten rechts).
// Mitte: Luftraum (offen zum EG), Flur, Bad, Ankleide.
export function FloorPlanOg({ children }: FloorPlanProps) {
  const wall = 'stroke-[var(--text-secondary)] fill-none';
  const interior = 'stroke-[var(--border)] fill-none';
  const label = 'fill-[var(--text-secondary)]';
  const compass = 'fill-[var(--text-secondary)] opacity-60';

  return (
    <svg viewBox="-700 -700 14520 11370" className="w-full h-auto" role="img" aria-label="Grundriss Obergeschoss">
      {/* Außenwand */}
      <rect x={0} y={0} width={13120} height={9970}
        className={wall} strokeWidth={80} />

      {/* Innenwände */}
      <g className={interior} strokeWidth={40}>
        {/* Vertikal links: Büro / Garderobe / Schlafzimmer ↔ zentraler Flur */}
        <line x1={4180} y1={0}    x2={4180} y2={9970} />
        {/* Vertikal rechts: zentraler Flur ↔ Pauls / Bad / Emils */}
        <line x1={8770} y1={0}    x2={8770} y2={9970} />
        {/* Horizontal: Büro/Ankleide */}
        <line x1={0}    y1={4380} x2={4180} y2={4380} />
        {/* Horizontal: Ankleide/Schlafzimmer */}
        <line x1={0}    y1={5800} x2={4180} y2={5800} />
        {/* Horizontal: Pauls/Bad */}
        <line x1={8770} y1={5000} x2={13120} y2={5000} />
        {/* Bad-Box */}
        <line x1={4180} y1={4900} x2={8770} y2={4900} />
        <line x1={4180} y1={6900} x2={8770} y2={6900} />
      </g>

      {/* Luftraum-Brüstung (offen zum EG) — gestrichelt */}
      <line x1={5200} y1={2700} x2={7920} y2={2700}
        className="stroke-[var(--border)] fill-none"
        strokeWidth={40} strokeDasharray="120 80" />

      {/* Raumbeschriftungen */}
      <g className={label} fontSize={300} textAnchor="middle">
        <text x={2090}  y={2300}>Büro</text>
        <text x={2090}  y={5200}>Ankleide</text>
        <text x={2090}  y={7900}>Schlafzimmer</text>
        <text x={10945} y={2500}>Pauls Zimmer</text>
        <text x={10945} y={7900}>Emils Zimmer</text>
        <text x={6485}  y={1700} fontSize={240} className="fill-[var(--text-secondary)] opacity-70">Luftraum</text>
        <text x={6485}  y={5950} fontSize={240} className="fill-[var(--text-secondary)] opacity-70">Bad</text>
        <text x={6485}  y={4400} fontSize={240} className="fill-[var(--text-secondary)] opacity-70">Flur</text>
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
