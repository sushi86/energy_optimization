'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Config {
  [key: string]: unknown;
}

interface PvSystemSettings {
  latitude: number;
  longitude: number;
  tiltDeg: number;
  azimuthDeg: number;
  kwp: number;
  vrmForecastEnabled: boolean;
  forecastSolarEnabled: boolean;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [mode, setMode] = useState('auto');
  const [setpoint, setSetpoint] = useState(-5000);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [pvSettings, setPvSettings] = useState<PvSystemSettings | null>(null);
  const [savingPv, setSavingPv] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
      })
      .catch(() => setMessage('Fehler beim Laden der Konfiguration'));

    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.controller?.mode) setMode(data.controller.mode);
        if (data.controller?.activeSetpoint !== undefined) setSetpoint(data.controller.activeSetpoint);
      })
      .catch(() => {});

    fetch('/api/settings/pv-system')
      .then((r) => r.json())
      .then((data) => setPvSettings(data))
      .catch(() => {});
  }, []);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) showMessage('Konfiguration gespeichert');
      else showMessage('Fehler beim Speichern');
    } catch {
      showMessage('Fehler beim Speichern');
    }
    setSaving(false);
  };

  const changeMode = async (newMode: string) => {
    setMode(newMode);
    try {
      const res = await fetch('/api/controller/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) showMessage(`Modus: ${newMode}`);
      else showMessage('Fehler beim Setzen des Modus');
    } catch {
      showMessage('Fehler beim Setzen des Modus');
    }
  };

  const changeSetpoint = async (value: number) => {
    setSetpoint(value);
    try {
      await fetch('/api/controller/setpoint', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setpointW: value }),
      });
    } catch { /* ignore */ }
  };

  const savePvSettings = async () => {
    setSavingPv(true);
    try {
      const res = await fetch('/api/settings/pv-system', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pvSettings),
      });
      if (res.ok) showMessage('PV-Anlage gespeichert');
      else showMessage('Fehler beim Speichern');
    } catch {
      showMessage('Fehler beim Speichern');
    }
    setSavingPv(false);
  };

  const updateConfigField = (key: string, value: string) => {
    if (!config) return;
    const num = Number(value);
    setConfig({ ...config, [key]: isNaN(num) ? value : num });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Einstellungen</h1>
        <Link
          href="/"
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        >
          Dashboard
        </Link>
      </header>

      {/* Status message */}
      {message && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-sm">
          {message}
        </div>
      )}

      {/* Mode Selector */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
        <p className="text-sm text-[var(--text-secondary)] mb-3">Modus</p>
        <div className="flex gap-2">
          {['auto', 'manual', 'winter'].map((m) => (
            <button
              key={m}
              onClick={() => changeMode(m)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                mode === m
                  ? m === 'auto'
                    ? 'bg-[#10EFD8]/20 text-[#10EFD8] border-[#10EFD8]/30'
                    : m === 'manual'
                      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                      : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  : 'bg-[var(--bg-card-hover)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]'
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Manual Setpoint */}
      <div className={`rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6 transition-opacity ${mode !== 'manual' ? 'opacity-50 pointer-events-none' : ''}`}>
        <p className="text-sm text-[var(--text-secondary)] mb-3">Manueller Sollwert</p>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={-12000}
            max={0}
            step={100}
            value={setpoint}
            onChange={(e) => changeSetpoint(Number(e.target.value))}
            className="flex-1 accent-[#10EFD8]"
          />
          <span className="text-lg font-semibold w-24 text-right">
            {setpoint.toLocaleString('de-DE')} W
          </span>
        </div>
      </div>

      {/* Price Optimization Toggle */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Preisoptimierte Einspeisung</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Verschiebt Einspeisung in Stunden mit hohen Börsenpreisen.
              Bei Negativpreisen wird nicht eingespeist.
            </p>
          </div>
          <button
            onClick={() => {
              const newConfig = { ...config, priceOptimization: !config?.priceOptimization };
              setConfig(newConfig);
              fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig),
              }).then(() => showMessage('Preisoptimierung ' + (newConfig.priceOptimization ? 'aktiviert' : 'deaktiviert')))
                .catch(() => showMessage('Fehler beim Speichern'));
            }}
            className={`relative w-12 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${
              config?.priceOptimization
                ? 'bg-[var(--accent)]'
                : 'bg-[var(--border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                config?.priceOptimization ? 'translate-x-6' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Feed-in Rate */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Einspeisevergütung</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Feste Vergütung für die Ertragsberechnung im Ladeplan.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={0.1}
              value={Number(config?.feedInRateCentPerKwh ?? 7)}
              onChange={(e) => updateConfigField('feedInRateCentPerKwh', e.target.value)}
              className="w-20 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] text-right focus:outline-none focus:border-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">ct/kWh</span>
          </div>
        </div>
      </div>

      {/* Preferred Max Charge Power */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Max. Ladeleistung (Plan)</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Bevorzugte Obergrenze für geplantes Laden. Wird nur überschritten, wenn der Forecast zu knapp ist.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={500}
              value={Number(config?.preferredMaxChargeW ?? 5000)}
              onChange={(e) => updateConfigField('preferredMaxChargeW', e.target.value)}
              className="w-24 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] text-right focus:outline-none focus:border-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">W</span>
          </div>
        </div>
      </div>

      {/* Consumption Base Load */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
        <p className="text-sm font-medium text-[var(--text-primary)] mb-1">Grundlast (Ladeplan)</p>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Erwarteter Grundverbrauch für die SOC-Prognose im Ladeplan.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm text-[var(--text-secondary)]">Tag (7–18 Uhr)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step={50}
                value={Number(config?.consumptionDayW ?? 500)}
                onChange={(e) => updateConfigField('consumptionDayW', e.target.value)}
                className="w-24 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] text-right focus:outline-none focus:border-[var(--accent)]"
              />
              <span className="text-sm text-[var(--text-secondary)]">W</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-[var(--text-secondary)]">Nacht (18–7 Uhr)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step={50}
                value={Number(config?.consumptionNightW ?? 350)}
                onChange={(e) => updateConfigField('consumptionNightW', e.target.value)}
                className="w-24 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] text-right focus:outline-none focus:border-[var(--accent)]"
              />
              <span className="text-sm text-[var(--text-secondary)]">W</span>
            </div>
          </div>
        </div>
      </div>

      {/* Forecast Provider Toggles */}
      {pvSettings && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
          <p className="text-sm text-[var(--text-secondary)] mb-4">PV-Prognose Quellen</p>
          {([
            { key: 'vrmForecastEnabled' as const, label: 'VRM Forecast', desc: 'Victron VRM Prognose' },
            { key: 'forecastSolarEnabled' as const, label: 'forecast.solar', desc: 'Drittanbieter Solarprognose' },
          ]).map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between mb-3 last:mb-0">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
                <p className="text-xs text-[var(--text-secondary)]">{desc}</p>
              </div>
              <button
                onClick={() => {
                  const updated = { ...pvSettings, [key]: !pvSettings[key] };
                  setPvSettings(updated);
                  fetch('/api/settings/pv-system', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updated),
                  }).then(() => showMessage(`${label} ${updated[key] ? 'aktiviert' : 'deaktiviert'}`))
                    .catch(() => showMessage('Fehler beim Speichern'));
                }}
                className={`relative w-12 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${
                  pvSettings[key]
                    ? 'bg-[var(--accent)]'
                    : 'bg-[var(--border)]'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    pvSettings[key] ? 'translate-x-6' : ''
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* PV System Settings */}
      {pvSettings && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
          <p className="text-sm text-[var(--text-secondary)] mb-4">PV-Anlage</p>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Konfiguration für forecast.solar Prognose.
          </p>
          <div className="space-y-3">
            {([
              { key: 'kwp', label: 'Leistung (kWp)', step: 0.1 },
              { key: 'tiltDeg', label: 'Neigung (°)', step: 1 },
              { key: 'azimuthDeg', label: 'Azimut (°)', step: 1 },
              { key: 'latitude', label: 'Breitengrad', step: 0.0001 },
              { key: 'longitude', label: 'Längengrad', step: 0.0001 },
            ] as const).map(({ key, label, step }) => (
              <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <label className="text-sm text-[var(--text-secondary)] sm:w-48 shrink-0">
                  {label}
                </label>
                <input
                  type="number"
                  step={step}
                  value={pvSettings[key]}
                  onChange={(e) =>
                    setPvSettings({ ...pvSettings, [key]: Number(e.target.value) })
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            ))}
          </div>
          <button
            onClick={savePvSettings}
            disabled={savingPv}
            className="mt-4 px-6 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-50"
          >
            {savingPv ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      )}

      {/* Config Form */}
      {config && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
          <p className="text-sm text-[var(--text-secondary)] mb-4">Konfiguration</p>
          <div className="space-y-3">
            {Object.entries(config).map(([key, value]) => {
              if (typeof value === 'object' || typeof value === 'boolean' || key === 'feedInRateCentPerKwh' || key === 'preferredMaxChargeW' || key === 'consumptionDayW' || key === 'consumptionNightW') return null;
              return (
                <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <label className="text-sm text-[var(--text-secondary)] sm:w-48 shrink-0">
                    {key}
                  </label>
                  <input
                    type={typeof value === 'number' ? 'number' : 'text'}
                    value={String(value)}
                    onChange={(e) => updateConfigField(key, e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              );
            })}
          </div>
          <button
            onClick={saveConfig}
            disabled={saving}
            className="mt-4 px-6 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-50"
          >
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      )}
    </div>
  );
}
