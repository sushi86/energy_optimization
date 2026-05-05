import type { ReactNode } from 'react';

export interface FloorPlanProps {
  children?: ReactNode;
}

export function FloorPlanEg({ children }: FloorPlanProps) {
  const wall = 'stroke-[var(--text-secondary)] stroke-[3] fill-none';
  const interior = 'stroke-[var(--border)] stroke-1 fill-none';
  const label = 'fill-[var(--text-secondary)] text-[20px]';

  return (
    <svg viewBox="0 0 1000 800" className="w-full h-auto" role="img" aria-label="Grundriss Erdgeschoss">
      <path d="M 80 80 L 920 80 L 920 720 L 80 720 Z" className={wall} />
      <path d="M 80 280 L 460 280 L 460 80" className={interior} />
      <path d="M 460 280 L 460 480 L 80 480" className={interior} />
      <path d="M 460 480 L 460 720" className={interior} />
      <path d="M 460 280 L 920 280" className={interior} />
      <path d="M 760 280 L 760 720" className={interior} />

      <text x="200" y="180" className={label}>Küche</text>
      <text x="600" y="180" className={label}>Essen</text>
      <text x="820" y="180" className={label}>Wohnen</text>
      <text x="200" y="380" className={label}>Diele</text>
      <text x="600" y="600" className={label}>Zimmer</text>
      <text x="200" y="600" className={label}>WC</text>

      <text x="500" y="50" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">SÜD</text>
      <text x="500" y="780" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">NORD</text>
      <text x="40"  y="400" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">OST</text>
      <text x="970" y="400" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">WEST</text>

      {children}
    </svg>
  );
}
