'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DailySummary {
  date: string;
  totalYieldKwh: number;
  feedInKwh: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  return `${monthNames[parseInt(m) - 1]} ${year}`;
}

function daysInMonth(month: string): number {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m, 0).getDate();
}

function getCurrentMonth(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 7);
}

function prevMonth(month: string): string {
  const d = new Date(`${month}-15`);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function nextMonth(month: string): string {
  const d = new Date(`${month}-15`);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
}

export default function HistoryPage() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/daily-summary?month=${month}`)
      .then(r => r.json())
      .then(data => setSummaries(data.summaries ?? []))
      .catch(() => setSummaries([]))
      .finally(() => setLoading(false));
  }, [month]);

  const isCurrentMonth = month === getCurrentMonth();
  const days = daysInMonth(month);

  const byDate = new Map(summaries.map(s => [s.date, s]));

  // Max of either revenue type for consistent scaling
  const maxRevenue = Math.max(
    ...summaries.map(s => Math.max(s.revenueFixedCent, s.revenueMarketCent)),
    1,
  );

  const totalFixed = summaries.reduce((s, d) => s + d.revenueFixedCent, 0);
  const totalMarket = summaries.reduce((s, d) => s + d.revenueMarketCent, 0);
  const totalFeedIn = summaries.reduce((s, d) => s + d.feedInKwh, 0);
  const totalYield = summaries.reduce((s, d) => s + d.totalYieldKwh, 0);

  return (
    <main className="min-h-screen bg-[var(--bg-main)] text-[var(--text-primary)] p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold">Ertrags-Historie</h1>
        <div className="w-16" />
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setMonth(prevMonth(month))}
          className="px-3 py-1.5 rounded bg-[var(--bg-card)] border border-[var(--border)] text-sm"
        >
          ←
        </button>
        <span className="text-base font-medium">{formatMonth(month)}</span>
        <button
          onClick={() => setMonth(nextMonth(month))}
          disabled={isCurrentMonth}
          className="px-3 py-1.5 rounded bg-[var(--bg-card)] border border-[var(--border)] text-sm disabled:opacity-30"
        >
          →
        </button>
      </div>

      {/* Monthly totals */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Einspeisung</div>
          <div className="text-lg font-semibold">{totalFeedIn.toFixed(1)} kWh</div>
          <div className="text-xs text-[var(--text-secondary)]">von {totalYield.toFixed(1)} kWh Ertrag</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Vergütung</div>
          <div className="text-lg font-semibold">{((totalFixed + totalMarket) / 100).toFixed(2)} €</div>
          <div className="text-xs text-[var(--text-secondary)]">
            <span className="text-amber-400">EEG {(totalFixed / 100).toFixed(2)}€</span>
            {' · '}
            <span className="text-emerald-400">Börse {(totalMarket / 100).toFixed(2)}€</span>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="flex items-center gap-4 mb-3 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" /> EEG
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400" /> Börse
          </span>
        </div>

        {loading ? (
          <div className="h-40 flex items-center justify-center text-[var(--text-secondary)] text-sm">Laden...</div>
        ) : summaries.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-[var(--text-secondary)] text-sm">Keine Daten für {formatMonth(month)}</div>
        ) : (
          <div className="flex items-end gap-px" style={{ height: '160px' }}>
            {Array.from({ length: days }, (_, i) => {
              const day = (i + 1).toString().padStart(2, '0');
              const date = `${month}-${day}`;
              const summary = byDate.get(date);
              const fixedPct = summary ? (summary.revenueFixedCent / maxRevenue) * 100 : 0;
              const marketPct = summary ? (summary.revenueMarketCent / maxRevenue) * 100 : 0;

              return (
                <div key={date} className="flex-1 min-w-0 flex flex-col items-center h-full justify-end group relative">
                  {/* Tooltip */}
                  {summary && (
                    <div className="absolute -top-16 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap text-[10px] bg-[var(--bg-card)] border border-[var(--border)] rounded px-2 py-1 z-10">
                      <div className="font-medium">{day}.{month.split('-')[1]}.</div>
                      <div>Einspeisung: {summary.feedInKwh.toFixed(1)} kWh</div>
                      <div className="text-amber-400">EEG: {(summary.revenueFixedCent / 100).toFixed(2)}€</div>
                      <div className="text-emerald-400">Börse: {(summary.revenueMarketCent / 100).toFixed(2)}€</div>
                    </div>
                  )}
                  {/* Side-by-side bars */}
                  <div className="w-full flex gap-px justify-center items-end" style={{ height: '90%' }}>
                    <div className="flex-1 bg-amber-400 rounded-t-sm" style={{ height: `${fixedPct}%`, minHeight: fixedPct > 0 ? '1px' : 0 }} />
                    <div className="flex-1 bg-emerald-400 rounded-t-sm" style={{ height: `${marketPct}%`, minHeight: marketPct > 0 ? '1px' : 0 }} />
                  </div>
                  {/* Day label */}
                  {(i + 1) % 5 === 1 && (
                    <span className="text-[8px] text-[var(--text-secondary)] mt-0.5">{i + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
