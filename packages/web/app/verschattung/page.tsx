import { Blinds } from 'lucide-react';

export default function VerschattungPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Blinds size={28} className="text-[var(--accent)]" />
          <h1 className="text-2xl font-bold tracking-tight">Verschattung</h1>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          Steuerung von Rollläden und Markisen.
        </p>
      </header>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center text-[var(--text-secondary)]">
        Implementierung folgt.
      </div>
    </div>
  );
}
