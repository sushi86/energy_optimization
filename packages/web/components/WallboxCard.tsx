'use client';

import { useEffect, useState, useCallback } from 'react';
import { EvCharger } from 'lucide-react';

interface WallboxState {
  status: 'available' | 'connected' | 'charging' | 'error' | 'unknown';
  rawStatus: number;
  vehicleConnected: boolean;
  connectorState: number;
  errorCode: number;
  powerW: number;
  energyTotalKwh: number;
  chargingCurrentA: number;
  currentsA: [number, number, number];
  voltagesV: [number, number, number];
  phases: 1 | 3;
  chargeDurationS: number;
  evseMaxCurrentA: number;
  evseMinCurrentA: number;
  cableMaxCurrentA: number;
  safeCurrentA: number;
  commTimeoutS: number;
  chargeMode: number;
  serial: string;
}

const statusLabels: Record<WallboxState['status'], string> = {
  available: 'Bereit',
  connected: 'Verbunden',
  charging: 'Lädt',
  error: 'Fehler',
  unknown: 'Unbekannt',
};

const statusColors: Record<WallboxState['status'], string> = {
  available: 'bg-[#10EFD8]/20 text-[#10EFD8] border-[#10EFD8]/30',
  connected: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  charging: 'bg-green-500/20 text-green-400 border-green-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
  unknown: 'bg-transparent text-[var(--text-secondary)] border-[var(--border)]',
};

function formatPower(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1000) return (watts / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' kW';
  return watts.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' W';
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default function WallboxCard() {
  const [state, setState] = useState<WallboxState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [pendingCurrent, setPendingCurrent] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/wallbox/status');
      if (!res.ok) {
        setError((await res.json()).error ?? `HTTP ${res.status}`);
        return;
      }
      setError(null);
      setState(await res.json());
    } catch {
      setError('Verbindung fehlgeschlagen');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const postAction = async (path: string, body?: object) => {
    await fetch(`/api/wallbox/${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    void refresh();
  };

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-4">
        <p className="text-sm text-[var(--text-secondary)] flex items-center gap-2"><EvCharger size={14} /> Wallbox</p>
        <p className="text-sm text-red-400 mt-2">{error}</p>
      </div>
    );
  }

  if (!state) return null;

  const displayCurrent = pendingCurrent ?? state.chargingCurrentA;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[var(--text-secondary)] flex items-center gap-2"><EvCharger size={14} /> Wallbox</p>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[state.status]}`}>
            {statusLabels[state.status]}
          </span>
          {state.vehicleConnected && (
            <span className="text-xs px-2 py-0.5 rounded-full border bg-[var(--border)]/30 text-[var(--text-secondary)] border-[var(--border)]">
              Fahrzeug verbunden
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Leistung</p>
          <p className="text-xl font-bold text-[var(--accent)]">{formatPower(state.powerW)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Strom</p>
          <p className="text-xl font-bold">{state.chargingCurrentA.toFixed(1)} A</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Phasen</p>
          <p className="text-xl font-bold">{state.phases}P</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => void postAction(state.status === 'charging' ? 'stop' : 'start')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer ${
            state.status === 'charging'
              ? 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
              : 'bg-[#10EFD8]/20 text-[#10EFD8] border-[#10EFD8]/30 hover:bg-[#10EFD8]/30'
          }`}
        >
          {state.status === 'charging' ? 'Stop' : 'Start'}
        </button>
        <div className="flex gap-1.5">
          {([1, 3] as const).map((p) => (
            <button
              key={p}
              onClick={() => void postAction('phases', { phases: p })}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors cursor-pointer ${
                state.phases === p
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  : 'bg-transparent text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]'
              }`}
            >
              {p}P
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <input
          type="range"
          min={6}
          max={16}
          step={1}
          value={displayCurrent}
          onChange={(e) => setPendingCurrent(Number(e.target.value))}
          onMouseUp={() => { if (pendingCurrent != null) void postAction('current', { ampere: pendingCurrent }); setPendingCurrent(null); }}
          onTouchEnd={() => { if (pendingCurrent != null) void postAction('current', { ampere: pendingCurrent }); setPendingCurrent(null); }}
          className="flex-1 accent-[var(--accent)] h-1.5"
        />
        <span className="text-sm font-semibold tabular-nums w-14 text-right">{displayCurrent.toFixed(0)} A</span>
      </div>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
      >
        {showDetails ? 'Details ausblenden' : 'Details anzeigen'}
      </button>

      {showDetails && (
        <div className="mt-3 pt-3 border-t border-[var(--border)] grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
          <div><span className="text-[var(--text-secondary)]">Ströme L1/L2/L3</span><br />{state.currentsA.map((c) => c.toFixed(1)).join(' / ')} A</div>
          <div><span className="text-[var(--text-secondary)]">Spannungen L1/L2/L3</span><br />{state.voltagesV.map((v) => v.toFixed(0)).join(' / ')} V</div>
          <div><span className="text-[var(--text-secondary)]">Energie gesamt</span><br />{state.energyTotalKwh.toFixed(1)} kWh</div>
          <div><span className="text-[var(--text-secondary)]">Ladedauer</span><br />{formatDuration(state.chargeDurationS)}</div>
          <div><span className="text-[var(--text-secondary)]">EVSE Max/Min</span><br />{state.evseMaxCurrentA.toFixed(1)} / {state.evseMinCurrentA.toFixed(1)} A</div>
          <div><span className="text-[var(--text-secondary)]">Kabel Max</span><br />{state.cableMaxCurrentA.toFixed(1)} A</div>
          <div><span className="text-[var(--text-secondary)]">Safe Current</span><br />{state.safeCurrentA.toFixed(1)} A</div>
          <div><span className="text-[var(--text-secondary)]">Comm-Timeout</span><br />{state.commTimeoutS} s</div>
          <div><span className="text-[var(--text-secondary)]">Charge Mode</span><br />{state.chargeMode}</div>
          <div><span className="text-[var(--text-secondary)]">Fehlercode</span><br />{state.errorCode}</div>
          <div><span className="text-[var(--text-secondary)]">Connector State</span><br />{state.connectorState}</div>
          <div><span className="text-[var(--text-secondary)]">Seriennummer</span><br />{state.serial || '—'}</div>
        </div>
      )}
    </div>
  );
}
