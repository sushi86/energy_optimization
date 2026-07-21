'use client';

import { useEffect, useState, useCallback } from 'react';

type WallboxMode = 'off' | 'pv' | 'manual';

interface WallboxStatusResponse {
  connected: boolean;
  // Backend has the wallbox configured but is still establishing the first
  // Modbus connection after startup — no state fields are available yet.
  initializing?: boolean;
  vehicleConnected: boolean;
  mode: WallboxMode;
  controllerDetails: { surplusW: number; targetCurrentA: number | null; reason: string } | null;
}

const modeLabels: Record<WallboxMode, string> = {
  off: 'Aus',
  pv: 'PV',
  manual: 'Manuell',
};

const modeColors: Record<WallboxMode, string> = {
  off: 'bg-red-500/20 text-red-400 border-red-500/30',
  pv: 'bg-[#10EFD8]/20 text-[#10EFD8] border-[#10EFD8]/30',
  manual: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

export default function WallboxControlCard({ onModeChange }: { onModeChange?: (mode: WallboxMode) => void }) {
  const [status, setStatus] = useState<WallboxStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // A hung request (e.g. the backend still reconnecting to the wallbox) must not
    // leave this component waiting forever for its first response — bound it so a
    // stall surfaces as a visible error instead of the card just never appearing.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch('/api/wallbox/status', { signal: controller.signal });
      if (!res.ok) {
        setError((await res.json()).error ?? `HTTP ${res.status}`);
        return;
      }
      setError(null);
      const data = (await res.json()) as WallboxStatusResponse;
      setStatus(data);
      onModeChange?.(data.mode);
    } catch {
      setError('Verbindung fehlgeschlagen');
    } finally {
      clearTimeout(abortTimer);
    }
  }, [onModeChange]);

  useEffect(() => {
    void refresh();
    // 1s so the live surplus/reason text (incl. the ticking "seit Ns" counters)
    // stays in sync with the backend, which now updates on every MQTT packet.
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  const changeMode = async (mode: WallboxMode) => {
    setStatus((s) => (s ? { ...s, mode } : s));
    onModeChange?.(mode);
    await fetch('/api/wallbox/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    void refresh();
  };

  // The card itself must always render — even before the first response ever
  // arrives, while the backend is still (re)connecting to the wallbox, or when a
  // request fails — so it never silently vanishes from the dashboard.
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${
            status?.connected
              ? 'bg-green-500/20 text-green-400 border-green-500/30'
              : status?.initializing
                ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                : 'bg-red-500/20 text-red-400 border-red-500/30'
          }`}
        >
          {status?.connected
            ? 'Modbus verbunden'
            : status?.initializing
              ? 'Initialisiere…'
              : error
                ? error
                : 'Verbindet…'}
        </span>
        {status && !status.initializing && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${
              status.vehicleConnected
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'bg-transparent text-[var(--text-secondary)] border-[var(--border)]'
            }`}
          >
            {status.vehicleConnected ? 'Fahrzeug verbunden' : 'Kein Fahrzeug'}
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        {(['off', 'pv', 'manual'] as const).map((m) => {
          const active = status?.mode === m;
          const colorClass = active
            ? modeColors[m]
            : 'bg-transparent text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]';
          return (
            <button
              key={m}
              onClick={() => void changeMode(m)}
              disabled={!status}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${colorClass}`}
            >
              {modeLabels[m]}
            </button>
          );
        })}
      </div>
      {status?.mode === 'pv' && status.controllerDetails && (
        <div className="mt-3 pt-3 border-t border-[var(--border)] text-xs space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-[var(--text-secondary)]">Überschuss</span>
            <span>{status.controllerDetails.surplusW.toLocaleString('de-DE')} W</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-[var(--text-secondary)]">Ziel-Ladestrom</span>
            <span>{status.controllerDetails.targetCurrentA != null ? `${status.controllerDetails.targetCurrentA} A` : '—'}</span>
          </div>
          <p className="text-[var(--text-secondary)] pt-1">{status.controllerDetails.reason}</p>
        </div>
      )}
    </div>
  );
}
