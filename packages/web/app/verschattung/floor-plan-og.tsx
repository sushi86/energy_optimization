import type { FloorPlanProps } from './floor-plan-eg';

export function FloorPlanOg({ children }: FloorPlanProps) {
  const wall = 'stroke-[var(--text-secondary)] stroke-[3] fill-none';
  const interior = 'stroke-[var(--border)] stroke-1 fill-none';
  const label = 'fill-[var(--text-secondary)] text-[20px]';

  return (
    <svg viewBox="0 0 1000 800" className="w-full h-auto" role="img" aria-label="Grundriss Obergeschoss">
      <path d="M 80 80 L 920 80 L 920 720 L 80 720 Z" className={wall} />
      <path d="M 500 80 L 500 720" className={interior} />
      <path d="M 80 380 L 920 380" className={interior} />

      <text x="250"  y="220" className={label}>Zimmer 4</text>
      <text x="750"  y="220" className={label}>Zimmer 1</text>
      <text x="250"  y="540" className={label}>Zimmer 3</text>
      <text x="750"  y="540" className={label}>Zimmer 2</text>

      <text x="500" y="50"  textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">SÜD</text>
      <text x="500" y="780" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">NORD</text>

      {children}
    </svg>
  );
}
