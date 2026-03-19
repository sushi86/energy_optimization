'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ScenarioSlot {
  hour: number;
  minute: number;
  chargePowerW: number;
  feedInPowerW: number;
  forecastW: number;
  estimatedSoc: number;
  consumptionW: number;
  clippingW: number;
}

interface Scenario {
  factor: number;
  totalPvKwh?: number;
  totalFeedInKwh?: number;
  totalRevenueFixedCent?: number;
  totalRevenueMarketCent?: number;
  slots?: ScenarioSlot[];
  error?: string;
}

interface ScenariosResponse {
  scenarios: Scenario[];
  currentFactor: number | null;
  autoFactor: number | null;
}

const TIME_GRID = Array.from({ length: 96 }, (_, i) => {
  const hour = Math.floor(i / 4);
  const minute = (i % 4) * 15;
  return { hour, minute, key: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}` };
});

function ScenarioChart({ slots }: { slots: ScenarioSlot[] }) {
  const slotByKey = new Map<string, ScenarioSlot>();
  for (const s of slots) {
    const key = `${s.hour.toString().padStart(2, '0')}:${s.minute.toString().padStart(2, '0')}`;
    slotByKey.set(key, s);
  }

  // Dynamic Y-axis
  const peakW = Math.max(
    ...slots.map(s => (s.chargePowerW ?? 0) + (s.feedInPowerW ?? 0) + (s.consumptionW ?? 0)),
    1,
  );
  const scaleSteps = [3000, 6000, 9000, 12000, 15000, 18000];
  const maxPower = scaleSteps.find(s => peakW <= s) ?? 18000;
  const maxKw = maxPower / 1000;
  const step = maxKw <= 3 ? 1 : maxKw <= 9 ? 2 : 3;
  const gridLines: { kw: number; bottomPct: number }[] = [];
  for (let kw = step; kw < maxKw; kw += step) {
    gridLines.push({ kw, bottomPct: (kw / maxKw) * 100 });
  }

  // SOC points
  const socPoints = TIME_GRID.map((slot, i) => {
    const s = slotByKey.get(slot.key);
    const soc = s?.estimatedSoc ?? (i === 0 ? 50 : null);
    return { x: (i + 0.5) * 100, soc };
  });
  let lastSoc = 50;
  for (const p of socPoints) {
    if (p.soc != null) lastSoc = p.soc;
    else p.soc = lastSoc;
  }

  return (
    <div>
      <div className="relative" style={{ height: '100px' }}>
        {/* Power grid lines */}
        {gridLines.map((line, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 pointer-events-none z-0"
            style={{ bottom: `${line.bottomPct}%` }}
          >
            <div className="w-full" style={{ borderTop: '1px dashed var(--text-secondary)', opacity: 0.2 }} />
            <span className="absolute left-0 -top-3 text-[9px] text-[var(--text-secondary)] opacity-60">
              {line.kw % 1 === 0 ? line.kw.toFixed(0) : line.kw.toFixed(1)} kW
            </span>
          </div>
        ))}

        {/* SOC line */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox={`0 0 ${96 * 100} 100`} preserveAspectRatio="none">
          <defs>
            <pattern id="hatch-full-scenario" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#10EFD8" strokeWidth="1.5" strokeOpacity="0.55" />
            </pattern>
          </defs>
          {(() => {
            const fullIdx = socPoints.findIndex(p => (p.soc ?? 0) >= 100);
            if (fullIdx < 0) return null;
            const startX = fullIdx * 100;
            return <rect x={startX} y={0} width={96 * 100 - startX} height={100} fill="url(#hatch-full-scenario)" />;
          })()}
          <polyline
            fill="none"
            stroke="#10EFD8"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            points={socPoints.map(p => `${p.x},${100 - (p.soc ?? 50)}`).join(' ')}
          />
        </svg>

        {/* Max SOC label */}
        {(() => {
          let maxSoc = 0;
          let maxIdx = 0;
          for (let i = 0; i < socPoints.length; i++) {
            const s = socPoints[i].soc ?? 0;
            if (s > maxSoc) { maxSoc = s; maxIdx = i; }
          }
          if (maxSoc <= 0) return null;
          const leftPct = ((maxIdx + 0.5) / 96) * 100;
          const bottomPct = maxSoc;
          return (
            <div
              className="absolute pointer-events-none z-20"
              style={{ left: `${leftPct}%`, bottom: `${bottomPct}%`, transform: 'translate(-50%, -2px)' }}
            >
              <span className="text-[10px] font-semibold text-[#10EFD8]">{Math.round(maxSoc)}%</span>
            </div>
          );
        })()}

        {/* SOC axis labels */}
        {[25, 50, 75, 100].map(soc => (
          <div
            key={soc}
            className="absolute right-0 pointer-events-none z-0"
            style={{ bottom: `${soc}%` }}
          >
            <span className="absolute right-0 -top-2 text-[9px] text-[#10EFD8] opacity-50">
              {soc}%
            </span>
          </div>
        ))}

        {/* Stacked bars */}
        <div className="flex items-end gap-px h-full">
          {TIME_GRID.map((slot) => {
            const h = slotByKey.get(slot.key);
            const chargeW = h?.chargePowerW ?? 0;
            const clippingW = Math.max(0, Math.min(h?.clippingW ?? 0, chargeW));
            const voluntaryW = Math.max(0, chargeW - clippingW);
            const feedInW = h?.feedInPowerW ?? 0;
            const consW = Math.max(0, h?.consumptionW ?? 0);

            const clippingPct = (clippingW / maxPower) * 100;
            const voluntaryPct = (voluntaryW / maxPower) * 100;
            const chargePct = clippingPct + voluntaryPct;
            const feedInPct = (feedInW / maxPower) * 100;
            const consPct = (consW / maxPower) * 100;
            const totalPct = chargePct + feedInPct + consPct;

            return (
              <div key={slot.key} className="flex-1 min-w-0 h-full flex items-end">
                <div className="relative w-full" style={{ height: `${Math.min(totalPct, 100)}%` }}>
                  {consW > 0 && (
                    <div
                      className="absolute bottom-0 w-full"
                      style={{
                        height: totalPct > 0 ? `${(consPct / totalPct) * 100}%` : '0%',
                        backgroundColor: '#ef4444',
                        opacity: 0.7,
                        minHeight: '2px',
                        borderRadius: !(feedInW > 0) && !(clippingW > 0) && !(voluntaryW > 0) ? '2px 2px 0 0' : '0',
                      }}
                    />
                  )}
                  {feedInW > 0 && (
                    <div
                      className="absolute w-full"
                      style={{
                        bottom: totalPct > 0 ? `${(consPct / totalPct) * 100}%` : '0%',
                        height: totalPct > 0 ? `${(feedInPct / totalPct) * 100}%` : '0%',
                        backgroundColor: '#22c55e',
                        opacity: 0.7,
                        minHeight: '2px',
                        borderRadius: !(clippingW > 0) && !(voluntaryW > 0) ? '2px 2px 0 0' : '0',
                      }}
                    />
                  )}
                  {clippingW > 0 && (
                    <div
                      className="absolute w-full"
                      style={{
                        bottom: totalPct > 0 ? `${((consPct + feedInPct) / totalPct) * 100}%` : '0%',
                        height: totalPct > 0 ? `${(clippingPct / totalPct) * 100}%` : '0%',
                        backgroundColor: '#eab308',
                        opacity: 0.7,
                        minHeight: '2px',
                        borderRadius: !(voluntaryW > 0) ? '2px 2px 0 0' : '0',
                      }}
                    />
                  )}
                  {voluntaryW > 0 && (
                    <div
                      className="absolute w-full rounded-t"
                      style={{
                        bottom: totalPct > 0 ? `${((consPct + feedInPct + clippingPct) / totalPct) * 100}%` : '0%',
                        height: totalPct > 0 ? `${(voluntaryPct / totalPct) * 100}%` : '0%',
                        backgroundColor: '#3b82f6',
                        opacity: 0.7,
                        minHeight: '2px',
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hour labels */}
      <div className="flex mt-1">
        {TIME_GRID.map((slot) => {
          const showLabel = slot.minute === 0 && slot.hour % 4 === 0;
          return (
            <div key={slot.key} className="flex-1 min-w-0 text-center">
              {showLabel && <span className="text-[9px] text-[var(--text-secondary)]">{slot.hour.toString().padStart(2, '0')}</span>}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[9px] text-[var(--text-secondary)] mt-1">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#3b82f6]" /> Laden</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#eab308]" /> Clipping</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#22c55e]" /> Einspeisung</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#ef4444]" /> Verbrauch</span>
        <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#10EFD8]" /> SOC</span>
      </div>
    </div>
  );
}

function formatEur(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface LiveStatus {
  pvPowerW: number;
  batterySoc: number;
  consumptionW: number;
}

function formatPower(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return (watts / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' kW';
  }
  return watts.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' W';
}

export default function ScenarioDecisionPage() {
  const [data, setData] = useState<ScenariosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [live, setLive] = useState<LiveStatus | null>(null);

  useEffect(() => {
    fetch('/api/charge-plan/scenarios?factors=0.5,1.25')
      .then((r) => r.json())
      .then((d: ScenariosResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setMessage('Fehler beim Laden der Szenarien');
        setLoading(false);
      });

    fetch('/api/status')
      .then((r) => r.json())
      .then((s: { pv: { power: number }; battery: { soc: number }; consumption: { power: number } }) => {
        setLive({ pvPowerW: s.pv.power, batterySoc: s.battery.soc, consumptionW: s.consumption.power });
      })
      .catch(() => {});
  }, []);

  const applyFactor = async (factor: number | null) => {
    setApplying(factor ?? -1);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forecastCorrectionOverride: factor }),
      });
      if (res.ok) {
        setData((d) => d ? { ...d, currentFactor: factor } : d);
        setMessage(factor === null ? 'Auf Auto gesetzt' : `Faktor ${factor}x angewendet`);
        setTimeout(() => setMessage(''), 3000);
      }
    } catch {
      setMessage('Fehler beim Speichern');
    }
    setApplying(null);
  };

  const isAutoActive = data?.currentFactor == null;
  const pessimistic = data?.scenarios.find(s => s.factor === 0.5);
  const optimistic = data?.scenarios.find(s => s.factor === 1.25);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Szenario-Auswahl</h1>
        <Link
          href="/"
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        >
          Dashboard
        </Link>
      </header>

      {/* Live status */}
      {live && (
        <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)] mb-4">
          <span>PV <span className="font-medium text-[var(--text-primary)]">{formatPower(live.pvPowerW)}</span></span>
          <span>Akku <span className="font-medium text-[#10EFD8]">{live.batterySoc}%</span></span>
          <span>Verbrauch <span className="font-medium text-[var(--text-primary)]">{formatPower(live.consumptionW)}</span></span>
          {data && (
            <span>Faktor <span className="font-medium text-[var(--text-primary)]">{data.currentFactor == null ? `Auto (${data.autoFactor?.toFixed(2) ?? '–'}x)` : `${data.currentFactor}x`}</span></span>
          )}
        </div>
      )}

      {message && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-sm">
          {message}
        </div>
      )}

      {loading ? (
        <div className="text-center text-[var(--text-secondary)] py-12">Lade Szenarien...</div>
      ) : (
        <div className="space-y-4">
          {/* Pessimistic scenario */}
          {pessimistic && !pessimistic.error && (
            <button
              onClick={() => applyFactor(0.5)}
              disabled={applying !== null}
              className={`w-full text-left rounded-xl border bg-[var(--bg-card)] p-4 transition-colors cursor-pointer ${
                data?.currentFactor === 0.5 ? 'border-[#10EFD8]/50' : 'border-[var(--border)] hover:border-[var(--text-secondary)]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-[var(--text-primary)]">Pessimistisch <span className="text-[var(--text-secondary)] font-normal">(0.5x)</span></p>
                {data?.currentFactor === 0.5 && (
                  <span className="text-xs text-[#10EFD8] bg-[#10EFD8]/10 px-2 py-0.5 rounded">Aktiv</span>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-4 text-sm">
                <span className="text-[var(--text-secondary)] text-xs">PV <span className="font-semibold text-[var(--text-primary)]">{pessimistic.totalPvKwh?.toFixed(1)} kWh</span></span>
                <span className="text-[var(--text-secondary)] text-xs">Einspeisung <span className="font-semibold text-[var(--text-primary)]">{pessimistic.totalFeedInKwh?.toFixed(1)} kWh</span></span>
                <span className="text-[var(--text-secondary)] text-xs">EEG <span className="font-semibold text-[var(--text-primary)]">{formatEur(pessimistic.totalRevenueFixedCent ?? 0)}&euro;</span></span>
                <span className="text-[var(--text-secondary)] text-xs">Börse <span className="font-semibold text-[var(--text-primary)]">{formatEur(pessimistic.totalRevenueMarketCent ?? 0)}&euro;</span></span>
              </div>

              {pessimistic.slots && pessimistic.slots.length > 0 && (
                <ScenarioChart slots={pessimistic.slots} />
              )}
            </button>
          )}

          {/* Auto */}
          <button
            onClick={() => applyFactor(null)}
            disabled={applying !== null}
            className={`w-full text-left rounded-xl border bg-[var(--bg-card)] p-4 transition-colors cursor-pointer ${
              isAutoActive ? 'border-[#10EFD8]/50' : 'border-[var(--border)] hover:border-[var(--text-secondary)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--text-primary)]">Auto</p>
              {isAutoActive && (
                <span className="text-xs text-[#10EFD8] bg-[#10EFD8]/10 px-2 py-0.5 rounded">Aktiv</span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Forecast-Korrektur wird automatisch anhand der tatsächlichen PV-Produktion angepasst.
            </p>
          </button>

          {/* Optimistic scenario */}
          {optimistic && !optimistic.error && (
            <button
              onClick={() => applyFactor(1.25)}
              disabled={applying !== null}
              className={`w-full text-left rounded-xl border bg-[var(--bg-card)] p-4 transition-colors cursor-pointer ${
                data?.currentFactor === 1.25 ? 'border-[#10EFD8]/50' : 'border-[var(--border)] hover:border-[var(--text-secondary)]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-[var(--text-primary)]">Optimistisch <span className="text-[var(--text-secondary)] font-normal">(1.25x)</span></p>
                {data?.currentFactor === 1.25 && (
                  <span className="text-xs text-[#10EFD8] bg-[#10EFD8]/10 px-2 py-0.5 rounded">Aktiv</span>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-4 text-sm">
                <span className="text-[var(--text-secondary)] text-xs">PV <span className="font-semibold text-[var(--text-primary)]">{optimistic.totalPvKwh?.toFixed(1)} kWh</span></span>
                <span className="text-[var(--text-secondary)] text-xs">Einspeisung <span className="font-semibold text-[var(--text-primary)]">{optimistic.totalFeedInKwh?.toFixed(1)} kWh</span></span>
                <span className="text-[var(--text-secondary)] text-xs">EEG <span className="font-semibold text-[var(--text-primary)]">{formatEur(optimistic.totalRevenueFixedCent ?? 0)}&euro;</span></span>
                <span className="text-[var(--text-secondary)] text-xs">Börse <span className="font-semibold text-[var(--text-primary)]">{formatEur(optimistic.totalRevenueMarketCent ?? 0)}&euro;</span></span>
              </div>

              {optimistic.slots && optimistic.slots.length > 0 && (
                <ScenarioChart slots={optimistic.slots} />
              )}
            </button>
          )}

          {/* Error states */}
          {pessimistic?.error && (
            <div className="rounded-xl border border-red-500/30 bg-[var(--bg-card)] p-4">
              <p className="text-sm font-medium text-red-400">Pessimistisch (0.5x)</p>
              <p className="text-xs text-red-400/70 mt-1">Fehler bei der Berechnung</p>
            </div>
          )}
          {optimistic?.error && (
            <div className="rounded-xl border border-red-500/30 bg-[var(--bg-card)] p-4">
              <p className="text-sm font-medium text-red-400">Optimistisch (1.25x)</p>
              <p className="text-xs text-red-400/70 mt-1">Fehler bei der Berechnung</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
