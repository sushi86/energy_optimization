'use client';
import type { components } from '@energy-control/shared';

type CoverState = components['schemas']['VerschattungCoverState'];

// Layout-Konstanten — alle in mm (= 1 svg-unit). ViewBox des Plans ist 13120 × 9970.
const WALL_THICKNESS = 80;
const GAP_PADDING = 40;          // erweitert das Erase-Rechteck über die Wandstärke hinaus
const COVER_THICKNESS = 280;
const COVER_OFFSET = 40;         // Abstand Cover-Bar zur Außenwand
const FRAME_STROKE = 25;
const PLAN_W = 13120;
const PLAN_H = 9970;

export interface CoverShapeProps {
  cover: CoverState;
  svg: { x: number; y: number; side: 'N' | 'S' | 'E' | 'W'; widthMm: number };
  onClick: () => void;
  selected?: boolean;
}

export function CoverShape({ cover, svg, onClick, selected }: CoverShapeProps) {
  const isHorizontal = svg.side === 'N' || svg.side === 'S';
  const pos = cover.currentPosition ?? 0;
  const fillFraction = pos / 100;

  // Wandlücke — überdeckt den Wandstrich an der Fensterposition
  const gapW = isHorizontal ? svg.widthMm : (WALL_THICKNESS + GAP_PADDING * 2);
  const gapH = isHorizontal ? (WALL_THICKNESS + GAP_PADDING * 2) : svg.widthMm;
  const gapX = svg.x - (isHorizontal ? svg.widthMm / 2 : (WALL_THICKNESS / 2 + GAP_PADDING));
  const gapY = svg.y - (isHorizontal ? (WALL_THICKNESS / 2 + GAP_PADDING) : svg.widthMm / 2);

  // Cover-Bar (außen vor der Wand)
  let barX = 0, barY = 0, barW = 0, barH = 0;
  let fillX = 0, fillY = 0, fillW = 0, fillH = 0;

  if (svg.side === 'N') {
    barW = svg.widthMm; barH = COVER_THICKNESS;
    barX = svg.x - barW / 2;
    barY = -(COVER_THICKNESS + COVER_OFFSET);
    fillX = barX; fillY = barY; fillW = barW;
    fillH = barH * fillFraction;
  } else if (svg.side === 'S') {
    barW = svg.widthMm; barH = COVER_THICKNESS;
    barX = svg.x - barW / 2;
    barY = PLAN_H + COVER_OFFSET;
    fillX = barX; fillW = barW;
    fillH = barH * fillFraction;
    fillY = barY + barH - fillH;
  } else if (svg.side === 'E') {
    barW = COVER_THICKNESS; barH = svg.widthMm;
    barX = -(COVER_THICKNESS + COVER_OFFSET);
    barY = svg.y - barH / 2;
    fillX = barX; fillY = barY; fillH = barH;
    fillW = barW * fillFraction;
  } else { // W
    barW = COVER_THICKNESS; barH = svg.widthMm;
    barX = PLAN_W + COVER_OFFSET;
    barY = svg.y - barH / 2;
    fillY = barY; fillH = barH;
    fillW = barW * fillFraction;
    fillX = barX + barW - fillW;
  }

  // Fenster-Rahmen (zwei dünne parallele Linien innerhalb der Lücke,
  // einer auf der Innen-, einer auf der Außenseite der ehemaligen Wand)
  const frameLines = isHorizontal ? (
    <>
      <line x1={gapX + GAP_PADDING} y1={svg.y - WALL_THICKNESS / 2}
            x2={gapX + gapW - GAP_PADDING} y2={svg.y - WALL_THICKNESS / 2}
            stroke="var(--text-secondary)" strokeOpacity={0.7} strokeWidth={FRAME_STROKE} />
      <line x1={gapX + GAP_PADDING} y1={svg.y + WALL_THICKNESS / 2}
            x2={gapX + gapW - GAP_PADDING} y2={svg.y + WALL_THICKNESS / 2}
            stroke="var(--text-secondary)" strokeOpacity={0.7} strokeWidth={FRAME_STROKE} />
    </>
  ) : (
    <>
      <line x1={svg.x - WALL_THICKNESS / 2} y1={gapY + GAP_PADDING}
            x2={svg.x - WALL_THICKNESS / 2} y2={gapY + gapH - GAP_PADDING}
            stroke="var(--text-secondary)" strokeOpacity={0.7} strokeWidth={FRAME_STROKE} />
      <line x1={svg.x + WALL_THICKNESS / 2} y1={gapY + GAP_PADDING}
            x2={svg.x + WALL_THICKNESS / 2} y2={gapY + gapH - GAP_PADDING}
            stroke="var(--text-secondary)" strokeOpacity={0.7} strokeWidth={FRAME_STROKE} />
    </>
  );

  // Prozent-Label — auf der Bar zentriert. Bei kleinen Fenstern (< 800 mm) auslagern.
  const labelX = isHorizontal ? barX + barW / 2 : barX + barW / 2;
  const labelY = isHorizontal ? barY + barH / 2 + 70 : barY + barH / 2 + 70;
  const labelTooSmall = (isHorizontal && barW < 800) || (!isHorizontal && barH < 800);

  return (
    <g onClick={onClick} className="cursor-pointer">
      {/* Wandlücke */}
      <rect x={gapX} y={gapY} width={gapW} height={gapH}
        fill="var(--bg-primary)" stroke="none" />
      {frameLines}
      {/* Cover-Bar Umriss */}
      <rect x={barX} y={barY} width={barW} height={barH}
        className={`fill-transparent stroke-[var(--accent)] ${selected ? 'opacity-100' : 'opacity-90'}`}
        strokeWidth={selected ? 50 : 25} />
      {/* Cover-Füllung (= Position) */}
      {fillFraction > 0 && (
        <rect x={fillX} y={fillY} width={fillW} height={fillH}
          className="fill-[var(--accent)] opacity-80 pointer-events-none" />
      )}
      {/* Override-Indikator */}
      {cover.state === 'OVERRIDE' && (
        <circle cx={barX + (isHorizontal ? barW - 100 : barW / 2)}
                cy={barY + (isHorizontal ? barH / 2 : 100)}
                r={60} className="fill-[var(--warning,#f59e0b)] pointer-events-none" />
      )}
      {/* Prozent-Label */}
      {!labelTooSmall && (
        <text x={labelX} y={labelY} textAnchor="middle" fontSize={180}
          className="fill-[var(--text-primary)] font-medium pointer-events-none">
          {pos}%
        </text>
      )}
      <title>{cover.label} — {pos}%{cover.state === 'OVERRIDE' ? ' · Override' : ''}</title>
    </g>
  );
}
