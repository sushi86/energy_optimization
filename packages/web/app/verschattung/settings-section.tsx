'use client';
import { useEffect, useState } from 'react';
import type { components } from '@energy-control/shared';

type Config = components['schemas']['VerschattungConfig'];

export function SettingsSection() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/verschattung/config').then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  if (!config) return null;

  const save = async (updated: Config) => {
    setConfig(updated);
    await fetch('/api/verschattung/config', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updated),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-4 text-sm">
      <h3 className="text-sm font-semibold flex items-center justify-between">
        Tunables
        {saved && <span className="text-xs text-[var(--accent)]">gespeichert</span>}
      </h3>

      <NumberField label="Innentemp-Schließschwelle (°C)" value={config.indoorTempThresholdC}
        onCommit={(v) => save({ ...config, indoorTempThresholdC: v })} />
      <NumberField label="Innentemp-Hysterese (°C)" value={config.hysteresisIndoorTempC}
        onCommit={(v) => save({ ...config, hysteresisIndoorTempC: v })} />

      <NumberField label="PV peak Wp" value={config.pvThreshold.peakWp}
        onCommit={(v) => save({ ...config, pvThreshold: { ...config.pvThreshold, peakWp: v } })} />
      <NumberField label="PV factor" step={0.05} value={config.pvThreshold.factor}
        onCommit={(v) => save({ ...config, pvThreshold: { ...config.pvThreshold, factor: v } })} />
      <NumberField label="PV floor (W)" value={config.pvThreshold.floorW}
        onCommit={(v) => save({ ...config, pvThreshold: { ...config.pvThreshold, floorW: v } })} />

      <NumberField label="PV-Hysterese-Faktor" step={0.05} value={config.hysteresisPvFactor}
        onCommit={(v) => save({ ...config, hysteresisPvFactor: v })} />
      <NumberField label="PV-Hysterese-Dauer (Minuten)" value={config.hysteresisPvDurationMinutes}
        onCommit={(v) => save({ ...config, hysteresisPvDurationMinutes: v })} />

      <div>
        <label className="block text-[var(--text-secondary)] mb-1">Sommermodus-Monate</label>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const on = config.summerModeMonths.includes(m);
            return (
              <button key={m}
                onClick={() => save({
                  ...config,
                  summerModeMonths: on
                    ? config.summerModeMonths.filter((x) => x !== m)
                    : [...config.summerModeMonths, m].sort((a, b) => a - b),
                })}
                className={`px-2 py-1 rounded text-xs border ${on ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)]'}`}>
                {m}
              </button>
            );
          })}
        </div>
      </div>

      {(['ost', 'sued', 'west'] as const).map((z) => (
        <NumberField key={z} label={`Zielposition ${z.toUpperCase()} (%)`} value={config.zones[z].closePosition}
          onCommit={(v) => save({ ...config, zones: { ...config.zones, [z]: { closePosition: v } } })} />
      ))}
    </div>
  );
}

function NumberField({ label, value, onCommit, step = 1 }: { label: string; value: number; onCommit: (v: number) => void; step?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <div className="flex justify-between items-center">
      <label className="text-[var(--text-secondary)]">{label}</label>
      <input type="number" step={step} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const v = Number(draft); if (Number.isFinite(v) && v !== value) onCommit(v); }}
        className="w-24 bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-right tabular-nums" />
    </div>
  );
}
