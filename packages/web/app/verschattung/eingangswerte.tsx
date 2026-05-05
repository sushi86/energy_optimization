'use client';
import type { components } from '@energy-control/shared';

type Inputs = components['schemas']['VerschattungInputs'];

export function Eingangswerte({ inputs }: { inputs: Inputs }) {
  const pvOk = inputs.pvPowerW != null && inputs.pvPowerW > inputs.pvThresholdW;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2">
      <h3 className="text-sm font-semibold">Eingangswerte</h3>
      <Row label="☀ Sonne" value={`${inputs.sun.azimuthDeg.toFixed(0)}° / ${inputs.sun.elevationDeg.toFixed(0)}°`} />
      <Row
        label="⚡ PV-Leistung"
        value={inputs.pvPowerW != null ? `${(inputs.pvPowerW / 1000).toFixed(2)} kW` : '—'}
        sub={`Schwelle ${(inputs.pvThresholdW / 1000).toFixed(2)} kW`}
        ok={pvOk}
      />
      <Row
        label="🏠 Innentemp"
        value={inputs.indoorTempC != null ? `${inputs.indoorTempC.toFixed(1)} °C` : '—'}
      />
      <Row
        label="📅 Sommermodus"
        value={inputs.isSummerMode ? 'aktiv' : 'inaktiv'}
        ok={inputs.isSummerMode}
      />
    </div>
  );
}

function Row({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={ok === true ? 'text-[var(--accent)]' : ok === false ? 'text-yellow-400' : ''}>
        {value}{sub ? <span className="text-[var(--text-secondary)] text-xs ml-2">({sub})</span> : null}
      </span>
    </div>
  );
}
