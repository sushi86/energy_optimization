import type { Zone } from './covers.js';

export type CoverState = 'IDLE' | 'CLOSED_BY_AUTO' | 'OVERRIDE';
export type DecisionAction = 'close' | 'open' | 'skip';

export interface EvaluatedCondition {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Decision {
  coverId: string;
  zone: Zone;
  action: DecisionAction;
  reason: string;
  evaluatedConditions: EvaluatedCondition[];
  appliedAt: string;        // ISO
  resultingState: CoverState;
  expectedPosition: number | null;
}
