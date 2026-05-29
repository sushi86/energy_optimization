'use client';

const WALL_THICKNESS = 80;
const GAP_PADDING = 40;
const FRAME_STROKE = 25;

export interface StaticWindowProps {
  svg: { x: number; y: number; side: 'N' | 'S' | 'E' | 'W'; widthMm: number };
  label?: string;
}

/** Fenster ohne steuerbaren Rolladen — nur Wandlücke + Rahmen. */
export function StaticWindow({ svg, label }: StaticWindowProps) {
  const isHorizontal = svg.side === 'N' || svg.side === 'S';
  const gapW = isHorizontal ? svg.widthMm : (WALL_THICKNESS + GAP_PADDING * 2);
  const gapH = isHorizontal ? (WALL_THICKNESS + GAP_PADDING * 2) : svg.widthMm;
  const gapX = svg.x - (isHorizontal ? svg.widthMm / 2 : (WALL_THICKNESS / 2 + GAP_PADDING));
  const gapY = svg.y - (isHorizontal ? (WALL_THICKNESS / 2 + GAP_PADDING) : svg.widthMm / 2);

  const frameLines = isHorizontal ? (
    <>
      <line x1={gapX + GAP_PADDING} y1={svg.y - WALL_THICKNESS / 2}
            x2={gapX + gapW - GAP_PADDING} y2={svg.y - WALL_THICKNESS / 2}
            stroke="var(--text-secondary)" strokeOpacity={0.5} strokeWidth={FRAME_STROKE} />
      <line x1={gapX + GAP_PADDING} y1={svg.y + WALL_THICKNESS / 2}
            x2={gapX + gapW - GAP_PADDING} y2={svg.y + WALL_THICKNESS / 2}
            stroke="var(--text-secondary)" strokeOpacity={0.5} strokeWidth={FRAME_STROKE} />
    </>
  ) : (
    <>
      <line x1={svg.x - WALL_THICKNESS / 2} y1={gapY + GAP_PADDING}
            x2={svg.x - WALL_THICKNESS / 2} y2={gapY + gapH - GAP_PADDING}
            stroke="var(--text-secondary)" strokeOpacity={0.5} strokeWidth={FRAME_STROKE} />
      <line x1={svg.x + WALL_THICKNESS / 2} y1={gapY + GAP_PADDING}
            x2={svg.x + WALL_THICKNESS / 2} y2={gapY + gapH - GAP_PADDING}
            stroke="var(--text-secondary)" strokeOpacity={0.5} strokeWidth={FRAME_STROKE} />
    </>
  );

  return (
    <g>
      <rect x={gapX} y={gapY} width={gapW} height={gapH} fill="var(--bg-primary)" stroke="none" />
      {frameLines}
      {label && <title>{label}</title>}
    </g>
  );
}
