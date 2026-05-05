'use client';
import type { components } from '@energy-control/shared';

type CoverState = components['schemas']['VerschattungCoverState'];

export interface CoverShapeProps {
  cover: CoverState;
  svg: { x: number; y: number; side: 'N' | 'S' | 'E' | 'W'; widthMm: number };
  onClick: () => void;
  selected?: boolean;
}

const COVER_LENGTH = 60;
const COVER_THICKNESS = 14;

export function CoverShape({ cover, svg, onClick, selected }: CoverShapeProps) {
  const isHorizontal = svg.side === 'N' || svg.side === 'S';
  const w = isHorizontal ? COVER_LENGTH : COVER_THICKNESS;
  const h = isHorizontal ? COVER_THICKNESS : COVER_LENGTH;
  const x = svg.x - w / 2;
  const y = svg.y - h / 2;

  const pos = cover.currentPosition ?? 0;
  const fillFraction = pos / 100;

  let fillX = x, fillY = y, fillW = w, fillH = h;
  if (isHorizontal) {
    fillH = h * fillFraction;
    if (svg.side === 'S') {
      fillY = y;
    } else {
      fillY = y + (h - fillH);
    }
  } else {
    fillW = w * fillFraction;
    if (svg.side === 'E') {
      fillX = x;
    } else {
      fillX = x + (w - fillW);
    }
  }

  return (
    <g onClick={onClick} className="cursor-pointer">
      <rect
        x={x} y={y} width={w} height={h}
        className={`fill-transparent stroke-[var(--accent)] stroke-[2] ${selected ? 'stroke-[3]' : ''}`}
      />
      {fillFraction > 0 && (
        <rect
          x={fillX} y={fillY} width={fillW} height={fillH}
          className="fill-[var(--accent)] opacity-80 pointer-events-none"
        />
      )}
      <title>{cover.label} — {pos}% {cover.state === 'OVERRIDE' ? '(Override)' : ''}</title>
    </g>
  );
}
