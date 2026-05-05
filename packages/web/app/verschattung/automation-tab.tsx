'use client';
import { useVerschattung } from '../../hooks/use-verschattung';
import { Eingangswerte } from './eingangswerte';
import { ZoneEvaluation } from './zone-evaluation';
import { DecisionLog } from './decision-log';
import { SettingsSection } from './settings-section';

export function AutomationTab() {
  const { state, decisions } = useVerschattung();

  if (!state) return <div className="text-[var(--text-secondary)]">Lade…</div>;

  return (
    <div className="space-y-4">
      <Eingangswerte inputs={state.inputs} />
      <ZoneEvaluation state={state} />
      <DecisionLog decisions={decisions} />
      <SettingsSection />
    </div>
  );
}
