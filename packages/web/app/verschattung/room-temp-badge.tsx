'use client';

export interface RoomTempBadgeProps {
  x: number;
  y: number;
  tempC: number | null;
  humidity?: number | null;
}

/** Dezentes Temperatur-/Luftfeuchte-Badge im Raum. Position in mm (svg-units). */
export function RoomTempBadge({ x, y, tempC, humidity }: RoomTempBadgeProps) {
  if (tempC == null) return null;
  const tempStr = tempC.toFixed(1).replace('.', ',') + ' °C';
  const humStr = humidity != null ? humidity.toFixed(0) + ' % rF' : null;

  return (
    <g pointerEvents="none">
      <text x={x} y={y} textAnchor="middle" fontSize={340}
        className="fill-[var(--text-primary)] font-medium">
        {tempStr}
      </text>
      {humStr && (
        <text x={x} y={y + 380} textAnchor="middle" fontSize={240}
          className="fill-[var(--text-secondary)]">
          {humStr}
        </text>
      )}
    </g>
  );
}
