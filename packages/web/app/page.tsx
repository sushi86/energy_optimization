import Link from 'next/link';
import { LayoutDashboard, Sun, Blinds } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <LayoutDashboard size={28} className="text-[var(--accent)]" />
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          Übersicht aller Subsysteme. Detailansichten findest du im Menü.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/solar"
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-[var(--accent)]/40 transition-colors"
        >
          <div className="flex items-center gap-3 mb-2">
            <Sun size={20} className="text-[var(--accent)]" />
            <h2 className="font-semibold">Solar</h2>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            PV, Batterie, Netz, Wallbox & Wärmepumpe.
          </p>
        </Link>

        <Link
          href="/verschattung"
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-[var(--accent)]/40 transition-colors"
        >
          <div className="flex items-center gap-3 mb-2">
            <Blinds size={20} className="text-[var(--accent)]" />
            <h2 className="font-semibold">Verschattung</h2>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            Rollläden & Markisen.
          </p>
        </Link>
      </div>
    </div>
  );
}
