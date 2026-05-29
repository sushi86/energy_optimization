'use client';

export interface SunIndicatorProps {
  azimuthDeg: number;
  elevationDeg: number;
}

// Mittelpunkt des Plans (in mm) und Radius der Sonnen-Umlaufbahn.
const CX = 6560, CY = 4985, RX = 7100, RY = 5400;

export function SunIndicator({ azimuthDeg, elevationDeg }: SunIndicatorProps) {
  if (elevationDeg < 0) return null;

  const rad = ((azimuthDeg - 180) * Math.PI) / 180;
  const x = CX + RX * Math.sin(rad);
  const y = CY - RY * Math.cos(rad);

  const intensity = Math.min(1, elevationDeg / 60);
  const r = 220 + 110 * intensity;
  const opacity = 0.5 + 0.5 * intensity;

  return (
    <g aria-label="Sonnenposition">
      <circle cx={x} cy={y} r={r * 1.6} className="fill-yellow-300" style={{ opacity: opacity * 0.3 }} />
      <circle cx={x} cy={y} r={r} className="fill-yellow-300" style={{ opacity }} />
      <title>Azimut {azimuthDeg.toFixed(0)}° / Elev {elevationDeg.toFixed(0)}°</title>
    </g>
  );
}
