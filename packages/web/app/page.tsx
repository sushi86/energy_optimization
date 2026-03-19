'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useWebSocket, type SystemStatus, type ControllerDetails, type ChargePlan, type ChargePlanSlot } from '../hooks/use-websocket';
import { berechneStrompreis, getTarifstufe } from './strompreis';
import { Heater, EvCharger } from 'lucide-react';

interface ForecastHour {
  timestamp: string;
  powerW: number;
}

interface PriceEntry {
  timestamp: number;
  price: number | null;
}

interface GridHistorySlot {
  time: string;
  avgPowerW: number;
  energyWh: number;
  samples: number;
}

function formatPower(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return (watts / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' kW';
  }
  return watts.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' W';
}

function formatDuration(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} min`;
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatEnergy(wh: number): string {
  const abs = Math.abs(wh);
  if (abs >= 1000) {
    return (wh / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' kWh';
  }
  return wh.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' Wh';
}

const modeColors: Record<string, string> = {
  auto: 'bg-[#10EFD8]/20 text-[#10EFD8] border-[#10EFD8]/30',
  manual: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  winter: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

function ModeSelector({ mode, onChangeMode }: { mode: string; onChangeMode: (m: string) => void }) {
  return (
    <div className="flex gap-1.5">
      {['auto', 'manual'].map((m) => {
        const active = mode.toLowerCase() === m;
        const colorClass = active
          ? modeColors[m]
          : 'bg-transparent text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]';
        return (
          <button
            key={m}
            onClick={() => onChangeMode(m)}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors cursor-pointer ${colorClass}`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        );
      })}
      <Link
        href="/scenario-decision"
        className="px-3 py-1 rounded-full text-sm font-medium border transition-colors cursor-pointer bg-transparent text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]"
      >
        Szenario
      </Link>
    </div>
  );
}

function ManualSetpointSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[var(--border)]">
      <input
        type="range"
        min={-12000}
        max={0}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-yellow-400 h-1.5"
      />
      <span className="text-sm font-semibold tabular-nums w-20 text-right text-yellow-400">
        {value.toLocaleString('de-DE')} W
      </span>
    </div>
  );
}

function RegulationCountdown({ lastTime, intervalMs }: { lastTime: string; intervalMs: number }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => {
      const elapsed = Date.now() - new Date(lastTime).getTime();
      setRemaining(Math.max(0, Math.ceil((intervalMs - elapsed) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lastTime, intervalMs]);

  return (
    <span className="text-xs text-[var(--text-secondary)] tabular-nums">
      {remaining}s
    </span>
  );
}

function formatPrice(eurMwh: number): string {
  return (eurMwh / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ct';
}

function CurrentPrice({ prices }: { prices: PriceEntry[] }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const now = Math.floor(Date.now() / 1000);
  let current: number | null = null;
  let next: number | null = null;
  let nextStart = 0;
  for (let i = 0; i < prices.length; i++) {
    const start = prices[i].timestamp;
    const end = i + 1 < prices.length ? prices[i + 1].timestamp : start + 900;
    if (now >= start && now < end) {
      current = prices[i].price;
      if (i + 1 < prices.length) {
        next = prices[i + 1].price;
        nextStart = prices[i + 1].timestamp;
      }
      break;
    }
  }

  if (current == null) return null;

  const secsUntilNext = nextStart > 0 ? Math.max(0, nextStart - now) : 0;
  const minsUntilNext = Math.floor(secsUntilNext / 60);
  const secsRemainder = secsUntilNext % 60;

  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border)]">
      <span className="text-xs text-[var(--text-secondary)]">
        Preis: <span className="font-medium text-white">{formatPrice(current)}/kWh</span>
      </span>
      {next != null && (
        <span className="text-xs text-[var(--text-secondary)]">
          · Nächste: <span className="font-medium text-white">{formatPrice(next)}/kWh</span>
          <span className="tabular-nums text-[var(--text-secondary)]"> in {minsUntilNext}:{secsRemainder.toString().padStart(2, '0')}</span>
        </span>
      )}
    </div>
  );
}

function handleTouchMove(e: React.TouchEvent, setHoveredSlot: (i: number | null) => void) {
  const touch = e.touches[0];
  const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
  if (!el) return;
  const bar = el.closest('[data-slot]') as HTMLElement | null;
  if (bar) {
    setHoveredSlot(Number(bar.dataset.slot));
  }
}

function PriceChart({ data, hoveredSlot, setHoveredSlot }: { data: PriceEntry[]; hoveredSlot: number | null; setHoveredSlot: (i: number | null) => void }) {
  const validPrices = data.filter((d) => d.price != null).map((d) => d.price!);
  const minPrice = Math.min(...validPrices);
  const maxPrice = Math.max(...validPrices);
  const range = maxPrice - minPrice || 1;
  const nowSec = Math.floor(Date.now() / 1000);

  // Horizontal grid lines at nice rounded price values
  const niceStep = (() => {
    const rangeCtKwh = range / 10; // convert €/MWh range to ct/kWh
    if (rangeCtKwh <= 5) return 10;  // 1 ct step in €/MWh
    if (rangeCtKwh <= 10) return 20;
    if (rangeCtKwh <= 25) return 50;
    return 100;
  })();
  const gridLines: { price: number; bottomPct: number; isZero: boolean }[] = [];
  const firstLine = Math.ceil(minPrice / niceStep) * niceStep;
  for (let price = firstLine; price < maxPrice; price += niceStep) {
    const bottomPct = ((price - minPrice) / range) * 80 + 20;
    gridLines.push({ price, bottomPct, isZero: price === 0 });
  }
  // Ensure 0 ct line is always present when prices span negative to positive
  if (minPrice < 0 && maxPrice > 0 && !gridLines.some((l) => l.price === 0)) {
    const bottomPct = ((0 - minPrice) / range) * 80 + 20;
    gridLines.push({ price: 0, bottomPct, isZero: true });
  }

  return (
    <div>
      <div className="flex items-end gap-px relative" style={{ height: '80px' }} onMouseLeave={() => setHoveredSlot(null)} onTouchMove={(e) => handleTouchMove(e, setHoveredSlot)} onTouchEnd={() => setHoveredSlot(null)}>
        {gridLines.map((line, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 pointer-events-none z-0"
            style={{ bottom: `${line.bottomPct}%` }}
          >
            <div
              className="w-full"
              style={{
                borderTop: line.isZero
                  ? '2px solid rgba(239, 68, 68, 0.6)'
                  : '1px dashed var(--text-secondary)',
                opacity: line.isZero ? 1 : 0.2,
              }}
            />
            <span className={`absolute left-0 -top-3 text-[9px] ${line.isZero ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)] opacity-60'}`}>
              {formatPrice(line.price)}
            </span>
          </div>
        ))}
        {data.map((d, i) => {
          const price = d.price;
          const heightPct = price != null ? ((price - minPrice) / range) * 80 + 20 : 0;
          const barDate = new Date(d.timestamp * 1000);
          const barSlotIndex = barDate.getHours() * 4 + Math.floor(barDate.getMinutes() / 15);
          const isHovered = hoveredSlot === barSlotIndex;
          const dimmed = hoveredSlot !== null && !isHovered;
          const isCurrent = nowSec >= d.timestamp && (i + 1 >= data.length || nowSec < data[i + 1].timestamp);

          const ratio = price != null ? (price - minPrice) / range : 0;
          let barColor = '#ef4444'; // low price = bad for feed-in
          if (ratio > 0.66) barColor = '#22c55e'; // high price = good
          else if (ratio > 0.33) barColor = '#eab308';

          return (
            <div
              key={d.timestamp}
              className="flex-1 min-w-0 relative"
              style={{ height: '100%' }}
              data-slot={barSlotIndex}
              onMouseEnter={() => setHoveredSlot(barSlotIndex)}
            >
              {isHovered && price != null && (() => {
                const bezug = berechneStrompreis(price / 10, barDate);
                const timeStr = `${barDate.getHours().toString().padStart(2, '0')}:${barDate.getMinutes().toString().padStart(2, '0')}`;
                return (
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium bg-[var(--bg-card)] border border-[var(--border)] rounded px-1.5 py-0.5 z-10">
                    <span className="text-[var(--text-secondary)]">{timeStr}</span> {formatPrice(price)} · Bezug: {bezug.gesamtpreisbrutto.toFixed(1)} ct ({bezug.tarifstufe})
                  </div>
                );
              })()}
              <div
                className="absolute bottom-0 w-full rounded-sm transition-opacity"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: barColor,
                  opacity: dimmed ? 0.3 : isCurrent ? 1 : 0.6,
                  outline: isCurrent ? '1.5px solid white' : 'none',
                }}
              />
            </div>
          );
        })}
      </div>
      {/* Tarifstufe color line */}
      <div className="flex gap-px mt-0.5" style={{ height: '4px' }}>
        {data.map((d) => {
          const barDate = new Date(d.timestamp * 1000);
          const stufe = getTarifstufe(barDate);
          const color = stufe === 'HT' ? '#ef4444' : stufe === 'ST' ? '#eab308' : '#22c55e';
          return (
            <div key={d.timestamp} className="flex-1 min-w-0 rounded-sm" style={{ backgroundColor: color, opacity: 0.35 }} />
          );
        })}
      </div>
      <div className="flex gap-px mt-0.5">
        {data.map((d, i) => {
          const isFullHour = new Date(d.timestamp * 1000).getMinutes() === 0;
          const hour = new Date(d.timestamp * 1000).getHours();
          const showLabel = isFullHour && hour % 2 === 0;
          return (
            <div key={d.timestamp} className="flex-1 min-w-0 text-center">
              {showLabel && <span className="text-[9px] text-[var(--text-secondary)]">{hour.toString().padStart(2, '0')}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Generate fixed 96-slot grid (00:00–23:45 local time) and build HH:MM lookup from data. */
function toLocalKey(isoTimestamp: string): string {
  const dt = new Date(isoTimestamp);
  return `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
}

const TIME_GRID = Array.from({ length: 96 }, (_, i) => {
  const hour = Math.floor(i / 4);
  const minute = (i % 4) * 15;
  return { hour, minute, key: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}` };
});

function currentSlotKey(): string {
  const now = new Date();
  const h = now.getHours();
  const m = Math.floor(now.getMinutes() / 15) * 15;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function ForecastCorrectionControl({ factor, serverOverride }: { factor: number; serverOverride?: number | null }) {
  const [localPct, setLocalPct] = useState<number | null>(null);
  const isManual = serverOverride != null;
  const displayPct = localPct != null ? localPct : Math.round(factor * 100);

  // Sync local state when server confirms
  useEffect(() => {
    setLocalPct(null);
  }, [factor]);

  const applyOverride = async (value: number | null) => {
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forecastCorrectionOverride: value }),
      });
    } catch { /* ignore */ }
  };

  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] text-[var(--text-secondary)] whitespace-nowrap">Korrektur</span>
      <input
        type="range"
        min={10}
        max={200}
        step={5}
        value={displayPct}
        onChange={(e) => {
          const val = Number(e.target.value);
          setLocalPct(val);
          void applyOverride(val / 100);
        }}
        className="flex-1 h-1 accent-[var(--accent)] cursor-pointer"
        style={{ maxWidth: '160px' }}
      />
      <span className={`text-[11px] font-medium min-w-[36px] text-right ${displayPct !== 100 ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>
        {displayPct}%
      </span>
      {isManual ? (
        <button
          onClick={() => {
            setLocalPct(null);
            void applyOverride(null);
          }}
          className="text-[10px] text-amber-400 hover:text-[var(--accent)] border border-amber-500/30 rounded px-1.5 py-0.5"
        >
          Auto
        </button>
      ) : (
        <span className="text-[10px] text-[var(--text-secondary)]">Auto</span>
      )}
    </div>
  );
}

function ForecastChart({ data, actual, vrm, solar, corrected, hoveredSlot, setHoveredSlot }: { data: ForecastHour[]; actual: ForecastHour[]; vrm?: ForecastHour[]; solar?: ForecastHour[]; corrected?: ForecastHour[]; hoveredSlot: number | null; setHoveredSlot: (i: number | null) => void }) {

  // Build lookups by local HH:MM key
  const forecastBySlot = new Map<string, number>();
  for (const d of data) forecastBySlot.set(toLocalKey(d.timestamp), d.powerW);

  const actualBySlot = new Map<string, number>();
  for (const a of actual) actualBySlot.set(toLocalKey(a.timestamp), a.powerW);

  const vrmBySlot = new Map<string, number>();
  if (vrm) for (const v of vrm) vrmBySlot.set(toLocalKey(v.timestamp), v.powerW);

  const solarBySlot = new Map<string, number>();
  if (solar) for (const s of solar) solarBySlot.set(toLocalKey(s.timestamp), s.powerW);

  const correctedBySlot = new Map<string, number>();
  if (corrected) for (const c of corrected) correctedBySlot.set(toLocalKey(c.timestamp), c.powerW);

  const allValues = [...data.map((d) => d.powerW), ...actual.map((d) => d.powerW), ...(corrected ?? []).map((c) => c.powerW)];
  const maxPower = Math.max(...allValues, 1);

  // Horizontal grid lines at nice rounded kW values
  const maxKw = maxPower / 1000;
  const pvStep = maxKw <= 3 ? 0.5 : maxKw <= 6 ? 1 : maxKw <= 15 ? 2 : 5;
  const pvGridLines: { kw: number; bottomPct: number }[] = [];
  for (let kw = pvStep; kw < maxKw; kw += pvStep) {
    pvGridLines.push({ kw, bottomPct: (kw / maxKw) * 100 });
  }

  return (
    <div>
      <div className="relative" style={{ height: '128px' }}>
        {/* Grid lines */}
        {pvGridLines.map((line, i) => (
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
        {/* Clipping threshold line at ~11kW */}
        {maxPower > 11000 && (
          <div
            className="absolute left-0 right-0 pointer-events-none z-10"
            style={{ bottom: `${(11000 / maxPower) * 100}%` }}
          >
            <div className="w-full" style={{ borderTop: '1.5px dashed rgba(234, 179, 8, 0.5)' }} />
            <span className="absolute right-0 -top-3 text-[9px] text-yellow-400/70">
              AC-Limit
            </span>
          </div>
        )}
        {/* Bars — fixed 96-slot grid 00:00–23:45 */}
        <div className="flex items-end gap-px h-full" onMouseLeave={() => setHoveredSlot(null)} onTouchMove={(e) => handleTouchMove(e, setHoveredSlot)} onTouchEnd={() => setHoveredSlot(null)}>
          {TIME_GRID.map((slot, i) => {
            const forecastW = forecastBySlot.get(slot.key) ?? 0;
            const correctedW = correctedBySlot.get(slot.key);
            const actualW = actualBySlot.get(slot.key);
            const vrmW = vrmBySlot.get(slot.key);
            const solarW = solarBySlot.get(slot.key);
            const hasCorrected = correctedW != null && correctedW !== forecastW;
            // When corrected, use corrected as main bar, original as faded background
            const mainW = hasCorrected ? correctedW : forecastW;
            const forecastPct = (forecastW / maxPower) * 100;
            const mainPct = (mainW / maxPower) * 100;
            const actualPct = actualW != null ? (actualW / maxPower) * 100 : 0;
            const isHovered = hoveredSlot === i;
            const isCurrent = slot.key === currentSlotKey();
            const dimmed = hoveredSlot !== null && !isHovered;

            return (
              <div
                key={slot.key}
                className="flex flex-col items-center flex-1 min-w-0 relative h-full"
                data-slot={i}
                onMouseEnter={() => setHoveredSlot(i)}
              >
                {isHovered && (forecastW > 0 || (actualW != null && actualW > 0)) && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium bg-[var(--bg-card)] border border-[var(--border)] rounded px-1.5 py-0.5 z-10">
                    <span className="text-[var(--text-secondary)]">{slot.key}</span>
                    {actualW != null && <>{' '}<span className="text-amber-400">{formatPower(actualW)}</span>{' / '}</>}
                    <span className="text-[var(--accent)]">{formatPower(mainW)}</span>
                    {hasCorrected && <span className="text-[var(--text-secondary)]"> ({formatPower(forecastW)})</span>}
                    {!hasCorrected && vrmW != null && solarW != null && (
                      <span className="text-[var(--text-secondary)]"> ({formatPower(vrmW)}|{formatPower(solarW)})</span>
                    )}
                  </div>
                )}
                <div className="w-full flex items-end justify-center h-full">
                  <div className="relative w-full" style={{ height: `${Math.max(forecastPct, mainPct, actualPct)}%` }}>
                    {/* Original forecast bar (faded background when corrected) */}
                    {hasCorrected && forecastW > 0 && (
                      <div
                        className="absolute bottom-0 w-full rounded-t"
                        style={{
                          height: `${(forecastPct / Math.max(forecastPct, mainPct, actualPct)) * 100}%`,
                          backgroundColor: 'var(--accent)',
                          opacity: dimmed ? 0.05 : 0.15,
                          minHeight: '2px',
                        }}
                      />
                    )}
                    {/* Corrected / main forecast bar */}
                    <div
                      className="absolute bottom-0 w-full rounded-t transition-opacity"
                      style={{
                        height: `${mainPct > 0 ? (mainPct / Math.max(forecastPct, mainPct, actualPct)) * 100 : 0}%`,
                        backgroundColor: 'var(--accent)',
                        opacity: dimmed ? 0.2 : isCurrent ? 1 : actual.length > 0 ? 0.3 : 0.45,
                        minHeight: mainW > 0 ? '2px' : '0px',
                        outline: isCurrent ? '1.5px solid white' : 'none',
                      }}
                    />
                    {/* Actual bar (foreground) */}
                    {actualW != null && actualW > 0 && (
                      <div
                        className="absolute bottom-0 w-full rounded-t transition-opacity"
                        style={{
                          height: `${(actualPct / Math.max(forecastPct, mainPct, actualPct)) * 100}%`,
                          backgroundColor: '#f59e0b',
                          opacity: dimmed ? 0.3 : 1,
                          minHeight: '2px',
                          outline: isCurrent ? '1.5px solid white' : 'none',
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Time labels — fixed 0–24h */}
      <div className="flex mt-1">
        {TIME_GRID.map((slot) => {
          const showLabel = slot.minute === 0 && slot.hour % 2 === 0;
          return (
            <div key={slot.key} className="flex-1 min-w-0 text-center">
              {showLabel && <span className="text-[10px] text-[var(--text-secondary)]">{slot.hour.toString().padStart(2, '0')}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function findPriceForSlot(prices: PriceEntry[], hour: number, minute: number): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const ts = Math.floor(d.getTime() / 1000);
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].timestamp <= ts && prices[i].price != null) return prices[i].price! / 10;
  }
  return 0;
}

function ChargePlanChart({ plan, hoveredSlot, setHoveredSlot, actualFeedIn, actualBattery, actualConsumption, actualSoc, prices, pvPeakKwp }: {
  plan: ChargePlan;
  hoveredSlot: number | null;
  setHoveredSlot: (i: number | null) => void;
  actualFeedIn: Map<string, { feedInW: number; feedInKwh: number }>;
  actualBattery: Map<string, number>;
  actualConsumption: Map<string, number>;
  actualSoc: Map<string, number>;
  prices: PriceEntry[];
  pvPeakKwp?: number;
}) {

  const [visibleSeries, setVisibleSeries] = useState({ charge: true, clipping: true, feedIn: true, consumption: true, soc: true });
  const toggle = (key: keyof typeof visibleSeries) => setVisibleSeries(prev => ({ ...prev, [key]: !prev[key] }));

  // Build lookup by HH:MM key from plan slots
  const slotByKey = new Map<string, ChargePlanSlot>();
  for (const s of plan.slots) {
    const key = `${s.hour.toString().padStart(2, '0')}:${s.minute.toString().padStart(2, '0')}`;
    slotByKey.set(key, s);
  }

  // Actual feed-in totals from meter readings
  const actualTotalKwh = Array.from(actualFeedIn.values()).reduce((sum, v) => sum + v.feedInKwh, 0);
  const hasActual = actualFeedIn.size > 0;

  // Actual revenue from real feed-in
  let actualRevenueFixedCent = 0;
  let actualRevenueMarketCent = 0;
  let actualNeg6hDeductionCent = 0;
  let actualNeg6hActive = false;
  if (hasActual) {
    // Per-hour revenue and price tracking for §51 rule
    const hourRevenue = new Map<number, { revenueCent: number; negative: boolean }>();
    for (const [key, val] of actualFeedIn) {
      const [hStr, mStr] = key.split(':');
      const hour = parseInt(hStr);
      const priceCtkwh = findPriceForSlot(prices, hour, parseInt(mStr));
      const revFixed = val.feedInKwh * plan.feedInRateCentPerKwh;
      actualRevenueFixedCent += revFixed;
      actualRevenueMarketCent += val.feedInKwh * priceCtkwh;
      // Track per-hour for §51
      const existing = hourRevenue.get(hour);
      const isNeg = priceCtkwh < 0;
      if (!existing) {
        hourRevenue.set(hour, { revenueCent: revFixed, negative: isNeg });
      } else {
        existing.revenueCent += revFixed;
        existing.negative = existing.negative && isNeg;
      }
    }
    // §51 EEG: detect 6+ consecutive hours of negative prices
    const hours = Array.from(hourRevenue.entries()).sort((a, b) => a[0] - b[0]);
    let streakStart = 0;
    for (let i = 0; i <= hours.length; i++) {
      const isNeg = i < hours.length && hours[i][1].negative;
      if (!isNeg) {
        if (i - streakStart >= 6) {
          for (let j = streakStart; j < i; j++) {
            actualNeg6hDeductionCent += hours[j][1].revenueCent;
          }
          actualNeg6hActive = true;
        }
        streakStart = i + 1;
      }
    }
    actualRevenueFixedCent -= actualNeg6hDeductionCent;
  }

  // Dynamic Y-axis: snap to 3/6/9/12 kW based on max value in data
  // Include actual history stacks (feed-in + battery charge + consumption) for past slots
  const actualStackPeaks = [...actualFeedIn.entries()].map(([key, a]) => {
    const battW = Math.max(0, actualBattery.get(key) ?? 0);
    const consW = actualConsumption.get(key) ?? 0;
    return a.feedInW + battW + consW;
  });
  const peakW = Math.max(
    ...plan.slots.map(s => (s.chargePowerW ?? 0) + (s.feedInPowerW ?? 0) + (s.consumptionW ?? 0)),
    ...actualStackPeaks,
    1,
  );
  const peakKwp = pvPeakKwp ?? 12;
  const scaleSteps = [3000, 6000, 9000, 12000, 15000, Math.ceil(peakKwp) * 1000];
  const sortedSteps = [...new Set(scaleSteps)].sort((a, b) => a - b);
  const maxPower = sortedSteps.find(s => peakW <= s) ?? sortedSteps[sortedSteps.length - 1];

  // Grid lines for power axis (left)
  const maxKw = maxPower / 1000;
  const step = maxKw <= 3 ? 1 : maxKw <= 9 ? 2 : 3;
  const gridLines: { kw: number; bottomPct: number }[] = [];
  for (let kw = step; kw < maxKw; kw += step) {
    gridLines.push({ kw, bottomPct: (kw / maxKw) * 100 });
  }

  // Build SOC points for SVG from the 96-slot grid
  // Use actual historical SOC for past slots, estimated for future
  const nowKey = currentSlotKey();
  const startSoc = plan.currentSoc ?? plan.slots[0]?.estimatedSoc ?? 50;
  const socPoints = TIME_GRID.map((slot, i) => {
    const actual = actualSoc.get(slot.key);
    if (actual != null && slot.key <= nowKey) {
      return { x: (i + 0.5) * 100, soc: actual };
    }
    const s = slotByKey.get(slot.key);
    const soc = s?.estimatedSoc ?? (i === 0 ? startSoc : null);
    return { x: (i + 0.5) * 100, soc };
  });
  // Fill gaps with last known SOC — use current SoC for pre-plan hours
  let lastSoc = startSoc;
  for (const p of socPoints) {
    if (p.soc != null) lastSoc = p.soc;
    else p.soc = lastSoc;
  }

  return (
    <div>
      {/* Header with daily revenue summary */}
      <div className="flex flex-col gap-1 mb-4">
        {hasActual && (
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-3">
              <p className="text-sm text-[var(--text-secondary)]">Einspeisung</p>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {actualTotalKwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-[var(--text-secondary)]">
                EEG: <span className="font-medium text-[var(--text-primary)]">{(actualRevenueFixedCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;</span>
                {actualNeg6hActive && (
                  <span className="relative inline-block ml-1 group">
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] font-bold cursor-help border border-yellow-500/30">i</span>
                    <span className="absolute bottom-full right-0 mb-1 hidden group-hover:block w-56 p-2 text-xs text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded shadow-lg z-50">
                      §51 EEG: Bei 6+ aufeinanderfolgenden Stunden mit negativen Börsenpreisen entfällt die Vergütung für diese Stunden (−{(actualNeg6hDeductionCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;).
                    </span>
                  </span>
                )}
              </span>
              <span className="text-[var(--text-secondary)]">
                Börse: <span className="font-medium text-[var(--text-primary)]">{(actualRevenueMarketCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;</span>
              </span>
            </div>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <p className="text-sm text-[var(--text-secondary)]">Forecast</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {plan.totalFeedInKwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--text-secondary)]">
              EEG: <span className="font-medium text-[var(--text-primary)]">{(plan.totalRevenueFixedCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;</span>
              {plan.negativeStreak6hActive && (
                <span className="relative inline-block ml-1 group">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] font-bold cursor-help border border-yellow-500/30">i</span>
                  <span className="absolute bottom-full right-0 mb-1 hidden group-hover:block w-56 p-2 text-xs text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded shadow-lg z-50">
                    §51 EEG: Bei 6+ aufeinanderfolgenden Stunden mit negativen Börsenpreisen entfällt die Vergütung für diese Stunden (−{((plan.negativeStreak6hDeductionCent ?? 0) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;).
                  </span>
                </span>
              )}
            </span>
            <span className="text-[var(--text-secondary)]">
              Börse: <span className="font-medium text-[var(--text-primary)]">{(plan.totalRevenueMarketCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;</span>
            </span>
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="relative" style={{ height: '128px' }}>
        {/* Power grid lines (left axis) */}
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

        {/* SOC line overlay using SVG — fixed 96-slot grid */}
        {visibleSeries.soc && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox={`0 0 ${96 * 100} 100`} preserveAspectRatio="none">
          <defs>
            <pattern id="hatch-full" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#10EFD8" strokeWidth="1.5" strokeOpacity="0.55" />
            </pattern>
          </defs>
          {/* Background highlight when SOC reaches 100% */}
          {(() => {
            const fullIdx = socPoints.findIndex(p => (p.soc ?? 0) >= 100);
            if (fullIdx < 0) return null;
            const startX = fullIdx * 100;
            return <rect x={startX} y={0} width={96 * 100 - startX} height={100} fill="url(#hatch-full)" />;
          })()}
          <polyline
            fill="none"
            stroke="#10EFD8"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            points={socPoints.map(p => `${p.x},${100 - (p.soc ?? 50)}`).join(' ')}
          />
          {plan.estimatedFullHour != null && (() => {
            const idx = TIME_GRID.findIndex(s => s.hour === plan.estimatedFullHour && s.minute === 0);
            if (idx < 0) return null;
            const p = socPoints[idx];
            return <circle cx={p.x} cy={100 - (p.soc ?? 50)} r="4" fill="#10EFD8" vectorEffect="non-scaling-stroke" />;
          })()}
        </svg>
        )}

        {/* Max SOC label at peak of curve */}
        {visibleSeries.soc && (() => {
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

        {/* SOC axis labels (right side) */}
        {visibleSeries.soc && [25, 50, 75, 100].map(soc => (
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

        {/* Stacked bars — fixed 96-slot grid */}
        {(() => { const nowKey = currentSlotKey(); return (
        <div className="flex items-end gap-px h-full" onMouseLeave={() => setHoveredSlot(null)} onTouchMove={(e) => handleTouchMove(e, setHoveredSlot)} onTouchEnd={() => setHoveredSlot(null)}>
          {TIME_GRID.map((slot, i) => {
            const h = slotByKey.get(slot.key);
            const rawChargeW = h?.chargePowerW ?? 0;
            const rawClippingW = Math.max(0, Math.min(h?.clippingW ?? 0, rawChargeW));
            const isPast = slot.key < nowKey;
            const actual = actualFeedIn.get(slot.key);
            const actualBattW = actualBattery.get(slot.key) ?? 0;
            const actualConsW = actualConsumption.get(slot.key) ?? 0;
            const hasActualHistory = isPast && (actual || actualBattW !== 0 || actualConsW > 0);

            // Apply visibility toggles
            const chargeW = visibleSeries.charge ? rawChargeW : 0;
            const clippingW = visibleSeries.clipping ? Math.min(rawClippingW, chargeW) : 0;
            const voluntaryW = Math.max(0, chargeW - clippingW);
            const feedInW = visibleSeries.feedIn ? ((isPast && actual) ? actual.feedInW : (h?.feedInPowerW ?? 0)) : 0;
            const battChargeW = (hasActualHistory && visibleSeries.charge) ? Math.max(0, actualBattW) : 0;
            const consW = hasActualHistory
              ? (visibleSeries.consumption ? Math.max(0, actualConsW) : 0)
              : (visibleSeries.consumption ? Math.max(0, h?.consumptionW ?? 0) : 0);

            const clippingPct = (clippingW / maxPower) * 100;
            const voluntaryPct = (voluntaryW / maxPower) * 100;
            const chargePct = clippingPct + voluntaryPct;
            const feedInPct = (feedInW / maxPower) * 100;
            const battChargePct = (battChargeW / maxPower) * 100;
            const consPct = (consW / maxPower) * 100;
            // Stack: feed-in + charge + consumption (past uses actual battery instead of plan charge)
            const totalPct = hasActualHistory
              ? feedInPct + battChargePct + consPct
              : chargePct + feedInPct + consPct;
            const isHovered = hoveredSlot === i;
            const isCurrent = slot.key === nowKey;
            const dimmed = hoveredSlot !== null && !isHovered;

            return (
              <div
                key={slot.key}
                className="flex flex-col items-center flex-1 min-w-0 relative h-full"
                data-slot={i}
                onMouseEnter={() => setHoveredSlot(i)}
              >
                {isHovered && (chargeW > 0 || feedInW > 0 || consW > 0 || battChargeW > 0) && (
                  <div className="absolute -top-14 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium bg-[var(--bg-card)] border border-[var(--border)] rounded px-1.5 py-1 z-20">
                    <span className="text-[var(--text-secondary)]">{slot.key}</span>
                    {hasActualHistory ? <>
                      {battChargeW > 0 && <>
                        {' · '}
                        <span className="text-blue-400">Laden: {formatPower(battChargeW)}</span>
                      </>}
                      {feedInW > 0 && <>
                        {' · '}
                        <span className="text-green-400">Einsp.: {formatPower(feedInW)}</span>
                      </>}
                      {consW > 0 && <>
                        {' · '}
                        <span className="text-red-400">Verbr.: {formatPower(consW)}</span>
                      </>}
                    </> : <>
                      {chargeW > 0 && <>
                        {' · '}
                        <span className="text-blue-400">Laden: {formatPower(chargeW)}</span>
                        {clippingW > 0 && <span className="text-yellow-400"> ({formatPower(clippingW)} Clipping)</span>}
                      </>}
                      {feedInW > 0 && <>
                        {' · '}
                        <span className="text-green-400">Einsp.: {formatPower(feedInW)}</span>
                      </>}
                      {consW > 0 && <>
                        {' · '}
                        <span className="text-red-400">Verbr.: {formatPower(consW)}</span>
                      </>}
                    </>}
                    {h && <>
                      {' · '}
                      <span className="text-[#10EFD8]">SOC: {h.estimatedSoc}%</span>
                    </>}
                    <br />
                    <span className="text-[var(--text-secondary)]">
                      EEG: {(isPast && actual
                        ? actual.feedInKwh * plan.feedInRateCentPerKwh
                        : h?.revenueFixedCent ?? 0
                      ).toFixed(1)}ct
                      {' · '}Börse: {(isPast && actual
                        ? actual.feedInKwh * findPriceForSlot(prices, slot.hour, slot.minute)
                        : h?.revenueMarketCent ?? 0
                      ).toFixed(1)}ct
                    </span>
                  </div>
                )}
                <div className="w-full flex items-end justify-center h-full">
                  <div className="relative w-full" style={{ height: `${Math.min(totalPct, 100)}%` }}>
                    {hasActualHistory ? <>
                      {/* Past slots: actual stacked bars — consumption (red) → feed-in (green) → battery (blue) */}
                      {consW > 0 && (
                        <div
                          className="absolute bottom-0 w-full transition-opacity"
                          style={{
                            height: totalPct > 0 ? `${(consPct / totalPct) * 100}%` : '0%',
                            backgroundColor: '#ef4444',
                            opacity: dimmed ? 0.2 : 0.8,
                            minHeight: '2px',
                            borderRadius: !(feedInW > 0) && !(battChargeW > 0) ? '2px 2px 0 0' : '0',
                          }}
                        />
                      )}
                      {feedInW > 0 && (
                        <div
                          className="absolute w-full transition-opacity"
                          style={{
                            bottom: totalPct > 0 ? `${(consPct / totalPct) * 100}%` : '0%',
                            height: totalPct > 0 ? `${(feedInPct / totalPct) * 100}%` : '0%',
                            backgroundColor: '#22c55e',
                            opacity: dimmed ? 0.2 : 0.8,
                            minHeight: '2px',
                            borderRadius: !(battChargeW > 0) ? '2px 2px 0 0' : '0',
                          }}
                        />
                      )}
                      {battChargeW > 0 && (
                        <div
                          className="absolute w-full rounded-t transition-opacity"
                          style={{
                            bottom: totalPct > 0 ? `${((consPct + feedInPct) / totalPct) * 100}%` : '0%',
                            height: totalPct > 0 ? `${(battChargePct / totalPct) * 100}%` : '0%',
                            backgroundColor: '#3b82f6',
                            opacity: dimmed ? 0.2 : 0.8,
                            minHeight: '2px',
                          }}
                        />
                      )}
                    </> : <>
                      {/* Future/current slots: plan bars — consumption (red) → feed-in (green) → clipping (yellow) → voluntary (blue) */}
                      {consW > 0 && (
                        <div
                          className="absolute bottom-0 w-full transition-opacity"
                          style={{
                            height: totalPct > 0 ? `${(consPct / totalPct) * 100}%` : '0%',
                            backgroundColor: '#ef4444',
                            opacity: dimmed ? 0.2 : isCurrent ? 1 : 0.6,
                            minHeight: '2px',
                            borderRadius: !(feedInW > 0) && !(clippingW > 0) && !(voluntaryW > 0) ? '2px 2px 0 0' : '0',
                          }}
                        />
                      )}
                      {feedInW > 0 && (
                        <div
                          className="absolute w-full transition-opacity"
                          style={{
                            bottom: totalPct > 0 ? `${(consPct / totalPct) * 100}%` : '0%',
                            height: totalPct > 0 ? `${(feedInPct / totalPct) * 100}%` : '0%',
                            backgroundColor: '#22c55e',
                            opacity: dimmed ? 0.2 : isCurrent ? 1 : 0.8,
                            minHeight: '2px',
                            outline: isCurrent ? '1.5px solid white' : 'none',
                            borderRadius: !(clippingW > 0) && !(voluntaryW > 0) ? '2px 2px 0 0' : '0',
                          }}
                        />
                      )}
                      {clippingW > 0 && (
                        <div
                          className="absolute w-full transition-opacity"
                          style={{
                            bottom: totalPct > 0 ? `${((consPct + feedInPct) / totalPct) * 100}%` : '0%',
                            height: totalPct > 0 ? `${(clippingPct / totalPct) * 100}%` : '0%',
                            backgroundColor: '#eab308',
                            opacity: dimmed ? 0.2 : isCurrent ? 1 : 0.8,
                            minHeight: '2px',
                            outline: isCurrent ? '1.5px solid white' : 'none',
                            borderRadius: !(voluntaryW > 0) ? '2px 2px 0 0' : '0',
                          }}
                        />
                      )}
                      {voluntaryW > 0 && (
                        <div
                          className="absolute w-full rounded-t transition-opacity"
                          style={{
                            bottom: totalPct > 0 ? `${((consPct + feedInPct + clippingPct) / totalPct) * 100}%` : '0%',
                            height: totalPct > 0 ? `${(voluntaryPct / totalPct) * 100}%` : '0%',
                            backgroundColor: '#3b82f6',
                            opacity: dimmed ? 0.2 : isCurrent ? 1 : 0.8,
                            minHeight: '2px',
                            outline: isCurrent ? '1.5px solid white' : 'none',
                          }}
                        />
                      )}
                    </>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        ); })()}
      </div>

      {/* Hour labels — fixed 0–24h */}
      <div className="flex mt-1">
        {TIME_GRID.map((slot) => {
          const showLabel = slot.minute === 0 && slot.hour % 2 === 0;
          return (
            <div key={slot.key} className="flex-1 min-w-0 text-center">
              {showLabel && <span className="text-[10px] text-[var(--text-secondary)]">{slot.hour.toString().padStart(2, '0')}</span>}
            </div>
          );
        })}
      </div>

      {/* Legend — click to toggle */}
      <div className="flex items-center gap-4 text-[10px] text-[var(--text-secondary)] mt-2 select-none">
        <button type="button" onClick={() => toggle('charge')} className={`flex items-center gap-1 ${visibleSeries.charge ? '' : 'opacity-30'}`}><span className="inline-block w-2 h-2 rounded-sm bg-[#3b82f6]" /> Laden</button>
        <button type="button" onClick={() => toggle('clipping')} className={`flex items-center gap-1 ${visibleSeries.clipping ? '' : 'opacity-30'}`}><span className="inline-block w-2 h-2 rounded-sm bg-[#eab308]" /> Clipping</button>
        <button type="button" onClick={() => toggle('feedIn')} className={`flex items-center gap-1 ${visibleSeries.feedIn ? '' : 'opacity-30'}`}><span className="inline-block w-2 h-2 rounded-sm bg-[#22c55e]" /> Einspeisung</button>
        <button type="button" onClick={() => toggle('consumption')} className={`flex items-center gap-1 ${visibleSeries.consumption ? '' : 'opacity-30'}`}><span className="inline-block w-2 h-2 rounded-sm bg-[#ef4444]" /> Verbrauch</button>
        <button type="button" onClick={() => toggle('soc')} className={`flex items-center gap-1 ${visibleSeries.soc ? '' : 'opacity-30'}`}><span className="inline-block w-2 h-2 rounded-full" style={{ width: '6px', height: '6px', backgroundColor: '#10EFD8' }} /> SOC</button>
      </div>
    </div>
  );
}

function usePullToRefresh(onRefresh: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);

  const THRESHOLD = 80;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling.current) return;
      const dy = e.touches[0].clientY - touchStartY.current;
      if (dy > 0) {
        // Prevent native scroll while pulling
        e.preventDefault();
        setPullDistance(Math.min(dy * 0.5, THRESHOLD * 1.5));
      } else {
        isPulling.current = false;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;
      if (pullDistance >= THRESHOLD) {
        setRefreshing(true);
        onRefresh();
        setTimeout(() => setRefreshing(false), 1000);
      }
      setPullDistance(0);
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onRefresh, pullDistance]);

  return { containerRef, pullDistance, refreshing, threshold: THRESHOLD };
}

function buildExportCsv(status: SystemStatus | null, prices: PriceEntry[]): string {
  if (!status) return '';
  const lines: string[] = [];

  // Snapshot header
  lines.push('# pvW,gridW,batteryW,consumptionW,soc,mode,setpointW,forecastCorrection,batteryCapKwh,targetSoc,priceOpt,feedInRateCt');
  const d = status.controller?.details;
  lines.push(`# ${status.pv.power},${status.grid.power},${status.battery.power},${status.consumption.power},${status.battery.soc},${status.controller?.mode ?? ''},${status.grid.setpoint},${status.chargePlan?.forecastCorrectionFactor ?? ''},${status.batteryCapacityKwh ?? ''},${d?.targetSocPercent ?? ''},${status.priceOptimizationEnabled ?? ''},${status.chargePlan?.feedInRateCentPerKwh ?? ''}`);

  // Future slots from charge plan
  const plan = status.chargePlan;
  if (!plan || plan.slots.length === 0) return lines.join('\n');

  const now = new Date();
  const futureSlots = plan.slots.filter(s => new Date(s.timestamp) >= now);
  if (futureSlots.length === 0) return lines.join('\n');

  // Debug info from charge plan
  const dbg = (plan as any).debug;
  if (dbg) {
    lines.push(`# debug: tightForecast=${dbg.tightForecast},priceOptCandidates=${dbg.priceOptCandidateCount},batteryNeedKwh=${dbg.batteryNeedKwh},voluntaryNeedKwh=${dbg.voluntaryNeedKwh},surplusRatio=${dbg.surplusRatio},totalClippingKwh=${dbg.totalClippingKwh},totalNetSurplusKwh=${dbg.totalNetSurplusKwh}`);
  }

  lines.push('time,forecastW,chargePowerW,feedInW,consumptionW,estSoc,revenueFixedCt,revenueMarketCt,priceMwh');
  for (const s of futureSlots) {
    const t = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
    // Use backend price (from findPrice in charge-plan.ts)
    const price = (s as any).priceMwh ?? '';
    lines.push(`${t},${s.forecastW},${s.chargePowerW},${s.feedInPowerW},${s.consumptionW ?? 0},${s.estimatedSoc},${s.revenueFixedCent},${s.revenueMarketCent},${price}`);
  }

  return lines.join('\n');
}

export default function Dashboard() {
  const { status, connected, reconnect } = useWebSocket();
  const [forecast, setForecast] = useState<ForecastHour[]>([]);
  const [forecastTotalKwh, setForecastTotalKwh] = useState<number>(0);
  const [actual, setActual] = useState<ForecastHour[]>([]);
  const [vrmForecast, setVrmForecast] = useState<ForecastHour[]>([]);
  const [solarForecast, setSolarForecast] = useState<ForecastHour[]>([]);
  const [prices, setPrices] = useState<PriceEntry[]>([]);
  const [gridHistory, setGridHistory] = useState<GridHistorySlot[]>([]);
  const [batteryHistory, setBatteryHistory] = useState<GridHistorySlot[]>([]);
  const [consumptionHistory, setConsumptionHistory] = useState<GridHistorySlot[]>([]);
  const [socHistory, setSocHistory] = useState<{ time: string; soc: number }[]>([]);
  const [manualSetpoint, setManualSetpoint] = useState(-5000);
  const [modeOverride, setModeOverride] = useState<string | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [csvCopied, setCsvCopied] = useState(false);

  // Sync mode from server status
  const serverMode = status?.controller?.mode ?? 'auto';
  const activeMode = modeOverride ?? serverMode;

  // Reset override once server confirms the mode change
  useEffect(() => {
    if (modeOverride && serverMode === modeOverride) {
      setModeOverride(null);
    }
  }, [serverMode, modeOverride]);

  // Sync setpoint from server when entering manual mode
  useEffect(() => {
    if (serverMode === 'manual' && status?.controller?.activeSetpoint !== undefined) {
      setManualSetpoint(status.controller.activeSetpoint);
    }
  }, [serverMode, status?.controller?.activeSetpoint]);

  const handleModeChange = async (newMode: string) => {
    setModeOverride(newMode);
    try {
      await fetch('/api/controller/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch { /* ignore */ }
  };

  const handleSetpointChange = async (value: number) => {
    setManualSetpoint(value);
    try {
      await fetch('/api/controller/setpoint', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setpointW: value }),
      });
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const fetchForecast = () => {
      fetch('/api/forecast')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setForecast(data);
          } else if (data?.hours) {
            setForecast(data.hours);
            if (typeof data.totalKwh === 'number') setForecastTotalKwh(data.totalKwh);
            if (Array.isArray(data.actual)) setActual(data.actual);
            if (Array.isArray(data.vrm)) setVrmForecast(data.vrm);
            if (Array.isArray(data.solar)) setSolarForecast(data.solar);
          }
        })
        .catch(() => {});
    };

    const fetchPrices = () => {
      fetch('/api/prices')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.entries)) setPrices(data.entries);
        })
        .catch(() => {});
    };

    const fetchGridHistory = () => {
      fetch('/api/grid/history')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.slots)) setGridHistory(data.slots);
        })
        .catch(() => {});
      fetch('/api/battery/history')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.slots)) setBatteryHistory(data.slots);
        })
        .catch(() => {});
      fetch('/api/consumption/history')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.slots)) setConsumptionHistory(data.slots);
        })
        .catch(() => {});
      fetch('/api/soc/history')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.slots)) setSocHistory(data.slots);
        })
        .catch(() => {});
    };

    fetchForecast();
    fetchPrices();
    fetchGridHistory();
    const forecastInterval = setInterval(fetchForecast, 5 * 60 * 1000);
    const priceInterval = setInterval(fetchPrices, 15 * 60 * 1000);
    const meterInterval = setInterval(fetchGridHistory, 5 * 60 * 1000);
    return () => { clearInterval(forecastInterval); clearInterval(priceInterval); clearInterval(meterInterval); };
  }, []);

  const handleRefresh = useCallback(() => {
    reconnect();
    // Also re-fetch forecast and prices
    fetch('/api/forecast')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setForecast(data);
        } else if (data?.hours) {
          setForecast(data.hours);
          if (typeof data.totalKwh === 'number') setForecastTotalKwh(data.totalKwh);
          if (Array.isArray(data.actual)) setActual(data.actual);
          if (Array.isArray(data.vrm)) setVrmForecast(data.vrm);
          if (Array.isArray(data.solar)) setSolarForecast(data.solar);
        }
      })
      .catch(() => {});
    fetch('/api/prices')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.entries)) setPrices(data.entries);
      })
      .catch(() => {});
    fetch('/api/grid/history')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.slots)) setGridHistory(data.slots); })
      .catch(() => {});
    fetch('/api/battery/history')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.slots)) setBatteryHistory(data.slots); })
      .catch(() => {});
    fetch('/api/consumption/history')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.slots)) setConsumptionHistory(data.slots); })
      .catch(() => {});
    fetch('/api/soc/history')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.slots)) setSocHistory(data.slots); })
      .catch(() => {});
  }, [reconnect]);

  const { containerRef, pullDistance, refreshing, threshold } = usePullToRefresh(handleRefresh);

  const pv = status?.pv?.power ?? 0;
  const consumption = status?.consumption?.power ?? 0;
  const gridPower = status?.grid?.power ?? 0;
  const batteryPower = status?.battery?.power ?? 0;
  const batterySoc = status?.battery?.soc ?? 0;
  const inverterPhases = status?.inverter?.phases ?? { L1: 0, L2: 0, L3: 0, feedIn: { L1: 0, L2: 0, L3: 0 }, selfConsumption: { L1: 0, L2: 0, L3: 0 } };
  const controller = status?.controller;
  const mpptTemperatureC = status?.mpptTemperatureC ?? null;
  const heatPumpPowerW = status?.heatPumpPowerW ?? null;
  const wallboxPowerW = status?.wallboxPowerW ?? null;
  const batteryCapacityKwh = status?.batteryCapacityKwh ?? 16;
  const multiplusRatedPowerW = status?.multiplusRatedPowerW ?? 4000;

  const actualFeedIn = useMemo(() => {
    const map = new Map<string, { feedInW: number; feedInKwh: number }>();
    for (const slot of gridHistory) {
      // Negative avgPowerW = feed-in, positive = consumption
      const feedInW = Math.max(0, -slot.avgPowerW);
      const feedInKwh = Math.max(0, -slot.energyWh) / 1000;
      if (feedInW > 0) {
        map.set(slot.time, { feedInW, feedInKwh });
      }
    }
    return map;
  }, [gridHistory]);

  const actualBattery = useMemo(() => {
    const map = new Map<string, number>();
    for (const slot of batteryHistory) {
      // Positive = charging, negative = discharging
      map.set(slot.time, slot.avgPowerW);
    }
    return map;
  }, [batteryHistory]);

  const actualConsumption = useMemo(() => {
    const map = new Map<string, number>();
    for (const slot of consumptionHistory) {
      map.set(slot.time, Math.abs(slot.avgPowerW));
    }
    return map;
  }, [consumptionHistory]);

  const actualSoc = useMemo(() => {
    const map = new Map<string, number>();
    for (const slot of socHistory) {
      map.set(slot.time, slot.soc);
    }
    return map;
  }, [socHistory]);

  // Estimate time to 100% (charging) or 20% (discharging)
  const batteryTimeEstimate = (() => {
    const absPower = Math.abs(batteryPower);
    if (absPower < 50) return null; // ignore negligible power
    const powerKw = absPower / 1000;
    if (batteryPower > 0) {
      // Charging — time to 100%
      const remainingPct = 100 - batterySoc;
      if (remainingPct <= 0) return null;
      const remainingKwh = (remainingPct / 100) * batteryCapacityKwh;
      const hours = remainingKwh / powerKw;
      return { label: '100%', duration: formatDuration(hours) };
    } else {
      // Discharging — time to 20%
      const drainablePct = batterySoc - 20;
      if (drainablePct <= 0) return null;
      const drainableKwh = (drainablePct / 100) * batteryCapacityKwh;
      const hours = drainableKwh / powerKw;
      return { label: '20%', duration: formatDuration(hours) };
    }
  })();

  return (
    <div ref={containerRef} className="overflow-y-auto" style={{ height: '100dvh', WebkitOverflowScrolling: 'touch' }}>
    <div className="max-w-4xl mx-auto px-4 py-6" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center transition-opacity"
          style={{
            height: `${refreshing ? 40 : pullDistance}px`,
            opacity: refreshing ? 1 : Math.min(1, pullDistance / threshold),
          }}
        >
          <svg
            className={`w-5 h-5 text-[var(--accent)] ${refreshing ? 'animate-spin' : ''}`}
            style={{ transform: refreshing ? undefined : `rotate(${(pullDistance / threshold) * 360}deg)` }}
            xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Energy Control</h1>
          <button
            onClick={reconnect}
            className={`w-2.5 h-2.5 rounded-full cursor-pointer ${connected ? 'bg-[#10EFD8]' : 'bg-red-500 animate-pulse'}`}
            title={connected ? 'Verbunden – Tippen zum Reconnect' : 'Getrennt – Tippen zum Reconnect'}
          />
        </div>
        <div className="flex items-center gap-3">
          {status?.priceOptimizationEnabled != null && (
            <span className={`text-xs px-2 py-0.5 rounded-full border ${status.priceOptimizationEnabled ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-[var(--text-secondary)] border-[var(--border)] bg-transparent'}`}>
              Preis {status.priceOptimizationEnabled ? 'An' : 'Aus'}
            </span>
          )}
          <Link
            href="/settings"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
          >
            Einstellungen
          </Link>
        </div>
      </header>

      {/* Main Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {/* PV Power */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <p className="text-sm text-[var(--text-secondary)] mb-1">PV-Leistung</p>
          <p className="text-3xl font-bold text-[var(--accent)]">{formatPower(pv)}</p>
        </div>

        {/* Consumption */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <div className="flex justify-between items-start mb-1">
            <p className="text-sm text-[var(--text-secondary)]">Verbrauch</p>
            <div className="flex flex-col items-end gap-0.5">
              {heatPumpPowerW !== null && (
                <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1" title="Wärmepumpe">
                  <Heater size={12} />
                  {formatPower(heatPumpPowerW)}
                </p>
              )}
              {wallboxPowerW !== null && wallboxPowerW > 0 && (
                <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1" title="Wallbox">
                  <EvCharger size={12} />
                  {formatPower(wallboxPowerW)}
                </p>
              )}
            </div>
          </div>
          <p className="text-3xl font-bold">{formatPower(consumption)}</p>
        </div>

        {/* Multiplus */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <p className="text-sm text-[var(--text-secondary)] mb-3">Multiplus</p>
          <div className="flex flex-col gap-2">
            {(['L1', 'L2', 'L3'] as const).map((phase) => {
              const watts = inverterPhases[phase];
              const percent = watts > 0 ? Math.round(watts / multiplusRatedPowerW * 100) : 0;
              const isOverload = percent > 100;
              const selfW = inverterPhases.selfConsumption?.[phase] ?? 0;
              const feedW = inverterPhases.feedIn?.[phase] ?? 0;
              const selfPct = watts > 0 ? Math.min(100, selfW / multiplusRatedPowerW * 100) : 0;
              const feedPct = watts > 0 ? Math.min(Math.max(0, 100 - selfPct), feedW / multiplusRatedPowerW * 100) : 0;
              return (
                <div key={phase}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-[var(--text-secondary)]">{phase}</span>
                    <span className="text-xs">
                      <span className="text-[var(--text-primary)]">{formatPower(watts)}</span>
                      {' · '}
                      <span style={{ color: isOverload ? '#f87171' : 'var(--accent)' }}>{percent}%</span>
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden flex">
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${selfPct}%`,
                        backgroundColor: isOverload ? '#f87171' : 'var(--accent)',
                      }}
                    />
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${feedPct}%`,
                        backgroundColor: '#facc15',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 2: Grid + Battery */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">

        {/* Grid */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <div className="flex justify-between items-start mb-1">
            <p className="text-sm text-[var(--text-secondary)]">Netz</p>
            {mpptTemperatureC !== null && (
              <p className="text-xs text-[var(--text-secondary)]" title="MPPT Laderegler Temperatur">
                {mpptTemperatureC.toLocaleString('de-DE', { maximumFractionDigits: 1 })} °C
              </p>
            )}
          </div>
          <p className={`text-3xl font-bold ${gridPower <= 0 ? 'text-[var(--accent)]' : 'text-red-400'}`}>
            {formatPower(gridPower)}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-[var(--text-secondary)]">
              {gridPower <= 0 ? 'Einspeisung' : 'Bezug'}
            </p>
            {controller && (
              <p className="text-xs text-[var(--text-secondary)]">
                · Soll: {formatPower(controller.activeSetpoint)}
              </p>
            )}
          </div>
          {prices.length > 0 && <CurrentPrice prices={prices} />}
        </div>

        {/* Battery */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <p className="text-sm text-[var(--text-secondary)] mb-1">Batterie</p>
          <p className="text-3xl font-bold">{batterySoc.toLocaleString('de-DE', { maximumFractionDigits: 0 })} %</p>
          <div className="mt-2 h-2 rounded-full bg-[var(--border)] overflow-hidden relative">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, batterySoc))}%`, backgroundColor: 'var(--accent)' }}
            />
            {controller?.details && controller.details.forcedChargeKwh > 0 && batteryCapacityKwh > 0 && (
              <div
                className="absolute inset-y-0 rounded-full transition-all duration-500"
                style={{
                  left: `${Math.min(100, Math.max(0, batterySoc))}%`,
                  width: `${Math.min(100 - batterySoc, Math.round(controller.details.forcedChargeKwh / batteryCapacityKwh * 100))}%`,
                  backgroundColor: 'rgba(234, 179, 8, 0.35)',
                }}
                title={`${controller.details.forcedChargeKwh.toFixed(1)} kWh durch Clipping gesichert`}
              />
            )}
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-2">
              <p className="text-xs text-[var(--text-secondary)]">{formatPower(batteryPower)}</p>
              {controller?.details && (
                <p className="text-xs text-[var(--text-secondary)]">
                  · Soll: {formatPower(controller.details.desiredChargePowerW)}
                </p>
              )}
            </div>
            {batteryTimeEstimate && (
              <p className="text-xs text-[var(--text-secondary)]">
                {batteryTimeEstimate.duration} → {batteryTimeEstimate.label}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Controller Status */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-8">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-[var(--text-secondary)]">Regler</p>
          {status?.regulation && (
            <RegulationCountdown lastTime={status.regulation.lastTime} intervalMs={status.regulation.intervalMs} />
          )}
        </div>
        {!controller || (!controller.details && !controller.reason) ? (
          <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <svg className="animate-spin h-4 w-4 text-[var(--accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Warte auf erste Berechnung...
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <ModeSelector mode={activeMode} onChangeMode={handleModeChange} />
              {activeMode === 'winter' && (
                <span className="px-3 py-1 rounded-full text-sm font-medium border bg-blue-500/20 text-blue-400 border-blue-500/30">
                  Winter
                </span>
              )}
            </div>
            {activeMode === 'manual' && (
              <ManualSetpointSlider value={manualSetpoint} onChange={handleSetpointChange} />
            )}
            {controller.details && (
              <div className="mt-3 space-y-2">
                {/* Strategy summary — show strategy if available, fallback to goal */}
                <p className="text-sm font-medium text-[var(--accent)]">
                  {controller.details.strategy || controller.details.goal}
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--text-secondary)]">
                  <span>Überschuss: {formatPower(controller.details.currentSurplusW)}</span>
                  <span>Soll-Ladung: {formatPower(controller.details.desiredChargePowerW)}</span>
                  <span>Soll-Einspeisung: {formatPower(controller.details.feedInW)}</span>
                  <span>Ist-Batterie: {formatPower(batteryPower)}</span>
                  <span>Batterie: {controller.details.batterySoc}% → {controller.details.targetSocPercent}%</span>
                  <span>Bedarf: {controller.details.batteryNeedKwh.toFixed(1)} kWh in {controller.details.remainingHours.toFixed(1)}h</span>
                  <span>Prognose Rest: {controller.details.remainingForecastKwh.toFixed(1)} kWh</span>
                  {controller.details.clippingHours > 0 && (
                    <span className="text-yellow-400">
                      Clipping: {controller.details.clippingHours}h → {controller.details.forcedChargeKwh.toFixed(1)} kWh gesichert ({Math.round(controller.details.forcedChargeKwh / batteryCapacityKwh * 100)}%)
                    </span>
                  )}
                  {controller.details.voluntaryChargeKwh > 0 && (
                    <span>Freiwillig: {controller.details.voluntaryChargeKwh.toFixed(1)} kWh</span>
                  )}
                  {controller.details.earlyClippingOverride ? (
                    <span className="text-green-400">Früh-Clipping Override — voll einspeisen</span>
                  ) : controller.details.isClippingRisk ? (
                    <span className="text-yellow-400">Clipping-Risiko aktiv</span>
                  ) : null}
                  {controller.details.priceOptimization?.active && (
                    <span className={
                      controller.details.priceOptimization.mode === 'negative'
                        ? 'text-red-400'
                        : controller.details.priceOptimization.mode === 'feed-in'
                          ? 'text-green-400'
                          : 'text-[var(--text-secondary)]'
                    }>
                      {controller.details.priceOptimization.reason}
                    </span>
                  )}
                </div>
              </div>
            )}
            {!controller.details && controller.reason && (
              <p className="text-sm text-[var(--text-secondary)] mt-2">{controller.reason}</p>
            )}
          </>
        )}
      </div>

      {/* Forecast Chart */}
      {forecast.length > 0 && (() => {
        const corrFactor = status?.chargePlan?.forecastCorrectionFactor ?? 1;
        const isCorrected = corrFactor !== 1;
        const correctedForecast = isCorrected
          ? forecast.map(f => ({ ...f, powerW: Math.round(f.powerW * corrFactor) }))
          : undefined;
        const correctedTotalKwh = isCorrected ? forecastTotalKwh * corrFactor : forecastTotalKwh;
        return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div className="flex items-baseline gap-3">
              <p className="text-sm text-[var(--text-secondary)]">PV-Prognose</p>
              <p className={`text-sm font-medium ${isCorrected ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--accent)]'}`}>
                {forecastTotalKwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh
              </p>
              {isCorrected && (
                <p className="text-sm font-medium text-[var(--accent)]">
                  {correctedTotalKwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh
                </p>
              )}
            </div>
            {actual.length > 0 && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[10px] text-[var(--text-secondary)]">Ist:</span>
                <p className="text-sm font-medium text-amber-400">
                  {(actual.reduce((sum, d) => sum + d.powerW * 0.25, 0) / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh
                </p>
              </div>
            )}
          </div>
          {/* Forecast correction slider — always visible */}
          <ForecastCorrectionControl factor={corrFactor} serverOverride={status?.forecastCorrectionOverride} />
          <ForecastChart data={forecast} actual={actual} vrm={vrmForecast} solar={solarForecast} corrected={correctedForecast} hoveredSlot={hoveredSlot} setHoveredSlot={setHoveredSlot} />
        </div>
        );
      })()}

      {/* Price Chart */}
      {prices.length > 0 ? (() => {
        const priceStartTime = new Date(prices[0].timestamp * 1000);
        const priceStartStr = `${priceStartTime.getHours().toString().padStart(2, '0')}:${priceStartTime.getMinutes().toString().padStart(2, '0')}`;
        const nowForBezug = new Date();
        const currentBezug = (() => {
          const nowSec = Math.floor(Date.now() / 1000);
          for (let i = 0; i < prices.length; i++) {
            const start = prices[i].timestamp;
            const end = i + 1 < prices.length ? prices[i + 1].timestamp : start + 900;
            if (nowSec >= start && nowSec < end && prices[i].price != null) {
              return berechneStrompreis(prices[i].price! / 10, nowForBezug);
            }
          }
          return null;
        })();
        return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mt-4">
          <p className="text-sm text-[var(--text-secondary)] mb-4">Strompreis</p>
          <PriceChart data={prices} hoveredSlot={hoveredSlot} setHoveredSlot={setHoveredSlot} />
        </div>
        );
      })() : status?.priceError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 mt-4">
          <p className="text-sm text-red-400">Strompreise nicht verfügbar: {status.priceError}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Ladeplanung deaktiviert bis Preise geladen werden können.</p>
        </div>
      ) : null}

      {/* Charge Plan Chart */}
      {status?.chargePlan && status.chargePlan.slots.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mt-4">
          <ChargePlanChart plan={status.chargePlan} hoveredSlot={hoveredSlot} setHoveredSlot={setHoveredSlot} actualFeedIn={actualFeedIn} actualBattery={actualBattery} actualConsumption={actualConsumption} actualSoc={actualSoc} prices={prices} pvPeakKwp={status.pvPeakKwp} />
        </div>
      )}

      {/* CSV Export */}
      {status?.chargePlan && (
        <div className="flex justify-center gap-3 mt-6 mb-8">
          <button
            onClick={() => {
              const csv = buildExportCsv(status, prices);
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(csv).then(() => {
                  setCsvCopied(true);
                  setTimeout(() => setCsvCopied(false), 2000);
                });
              } else {
                const textarea = document.createElement('textarea');
                textarea.value = csv;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                setCsvCopied(true);
                setTimeout(() => setCsvCopied(false), 2000);
              }
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {csvCopied ? 'Kopiert!' : 'CSV exportieren'}
          </button>
          <Link
            href="/history"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Historie
          </Link>
        </div>
      )}
    </div>
    </div>
  );
}
