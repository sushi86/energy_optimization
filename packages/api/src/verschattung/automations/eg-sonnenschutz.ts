import { ZONE_AZIMUTH_RANGES, type Zone, coversInZone } from '../covers.js';
import type { VerschattungConfig } from '../config.js';
import type { VerschattungContext } from '../context.js';
import type { Decision, EvaluatedCondition, CoverState } from '../decision.js';
import type { OverrideStateTracker } from '../override-state.js';

const ZONES: Zone[] = ['ost', 'sued', 'west'];

export function evaluateEgSonnenschutz(
  ctx: VerschattungContext,
  config: VerschattungConfig,
  tracker: OverrideStateTracker,
): Decision[] {
  const decisions: Decision[] = [];

  for (const zone of ZONES) {
    const zoneCtx = ctx.zones[zone];
    const closePosition = config.zones[zone].closePosition;
    const covers = coversInZone(zone);

    const sharedConditions = buildSharedConditions(ctx, config, zone);
    const allOk = sharedConditions.every((c) => c.ok);

    for (const cover of covers) {
      const stateEntry = tracker.getState(cover.id);
      const currentPos = ctx.coverPositions.get(cover.id) ?? null;

      // CASE 1: Cover in OVERRIDE → never touch
      if (stateEntry.state === 'OVERRIDE') {
        decisions.push(makeDecision({
          ctx, cover, zone, action: 'skip',
          reason: 'Cover ist in OVERRIDE — User-Position wird respektiert',
          conditions: sharedConditions,
          state: 'OVERRIDE',
          expectedPosition: stateEntry.expectedPosition,
        }));
        continue;
      }

      // CASE 2: Cover currently CLOSED_BY_AUTO — check open conditions
      if (stateEntry.state === 'CLOSED_BY_AUTO') {
        const openTrigger = checkOpenTrigger(ctx, config, zoneCtx);
        if (openTrigger) {
          decisions.push(makeDecision({
            ctx, cover, zone, action: 'open',
            reason: openTrigger,
            conditions: sharedConditions,
            state: 'IDLE',
            expectedPosition: 100,
          }));
        } else {
          decisions.push(makeDecision({
            ctx, cover, zone, action: 'skip',
            reason: 'Schließ-Bedingungen weiterhin gegeben — Cover bleibt geschlossen',
            conditions: sharedConditions,
            state: 'CLOSED_BY_AUTO',
            expectedPosition: stateEntry.expectedPosition,
          }));
        }
        continue;
      }

      // CASE 3: IDLE — evaluate close conditions
      if (allOk) {
        if (currentPos !== null && Math.abs(currentPos - closePosition) <= 5) {
          decisions.push(makeDecision({
            ctx, cover, zone, action: 'skip',
            reason: 'Cover bereits in Schließ-Position',
            conditions: sharedConditions,
            state: 'IDLE',
            expectedPosition: null,
          }));
        } else {
          decisions.push(makeDecision({
            ctx, cover, zone, action: 'close',
            reason: oneLineCloseReason(ctx, config, zone),
            conditions: sharedConditions,
            state: 'CLOSED_BY_AUTO',
            expectedPosition: closePosition,
          }));
        }
      } else {
        const failing = sharedConditions.find((c) => !c.ok);
        decisions.push(makeDecision({
          ctx, cover, zone, action: 'skip',
          reason: failing ? `Schließ-Bedingung nicht erfüllt: ${failing.name} — ${failing.detail}` : 'Schließ-Bedingungen nicht erfüllt',
          conditions: sharedConditions,
          state: 'IDLE',
          expectedPosition: null,
        }));
      }
    }
  }

  return decisions;
}

function buildSharedConditions(
  ctx: VerschattungContext,
  config: VerschattungConfig,
  zone: Zone,
): EvaluatedCondition[] {
  const range = ZONE_AZIMUTH_RANGES[zone];
  const inZone = ctx.zones[zone].inZone;
  const pv = ctx.pvPowerW;
  const temp = ctx.indoorTempC;
  const monthOk = ctx.isSummerMode;
  const month = ctx.now.getUTCMonth() + 1;

  return [
    {
      name: 'Sonne in Zone',
      ok: inZone,
      detail: `Azimut ${ctx.sun.azimuthDeg.toFixed(0)}° ∈ [${range.from}°, ${range.to}°]`,
    },
    {
      name: 'PV-Schwelle überschritten',
      ok: pv !== null && pv > ctx.pvThresholdW,
      detail: pv === null
        ? 'PV-Wert nicht verfügbar'
        : `${(pv / 1000).toFixed(2)} kW > ${(ctx.pvThresholdW / 1000).toFixed(2)} kW (Elev ${ctx.sun.elevationDeg.toFixed(0)}°)`,
    },
    {
      name: 'Innentemperatur ≥ Schwelle',
      ok: temp !== null && temp >= config.indoorTempThresholdC,
      detail: temp === null
        ? 'Innentemp nicht verfügbar'
        : `${temp.toFixed(1)} °C ≥ ${config.indoorTempThresholdC} °C`,
    },
    {
      name: 'Sommermodus aktiv',
      ok: monthOk,
      detail: `Monat ${month} ∈ [${config.summerModeMonths.join(', ')}]`,
    },
  ];
}

function checkOpenTrigger(
  ctx: VerschattungContext,
  config: VerschattungConfig,
  zoneCtx: VerschattungContext['zones'][Zone],
): string | null {
  if (!zoneCtx.inZone) return 'Sonne hat Zone verlassen';

  if (
    ctx.pvBelowHalfThresholdSinceMs !== null &&
    (ctx.now.getTime() - ctx.pvBelowHalfThresholdSinceMs) >= config.hysteresisPvDurationMinutes * 60_000
  ) {
    return `PV ≥ ${config.hysteresisPvDurationMinutes} min unter ${(config.hysteresisPvFactor * 100).toFixed(0)} % der Schwelle (Wolken)`;
  }

  if (
    ctx.indoorTempC !== null &&
    ctx.indoorTempC < (config.indoorTempThresholdC - config.hysteresisIndoorTempC)
  ) {
    return `Innentemp ${ctx.indoorTempC.toFixed(1)} °C < ${config.indoorTempThresholdC - config.hysteresisIndoorTempC} °C`;
  }

  if (!ctx.isSummerMode) return 'Sommermodus endet';

  return null;
}

function oneLineCloseReason(ctx: VerschattungContext, config: VerschattungConfig, zone: Zone): string {
  const pv = ctx.pvPowerW;
  const temp = ctx.indoorTempC;
  return `Sonne in ${zone.toUpperCase()} (${ctx.sun.azimuthDeg.toFixed(0)}°), PV ${pv !== null ? (pv / 1000).toFixed(1) + ' kW' : '?'} > ${(ctx.pvThresholdW / 1000).toFixed(1)} kW Schwelle, innen ${temp !== null ? temp.toFixed(1) + ' °C' : '?'} ≥ ${config.indoorTempThresholdC} °C`;
}

function makeDecision(args: {
  ctx: VerschattungContext;
  cover: { id: string };
  zone: Zone;
  action: Decision['action'];
  reason: string;
  conditions: EvaluatedCondition[];
  state: CoverState;
  expectedPosition: number | null;
}): Decision {
  return {
    coverId: args.cover.id,
    zone: args.zone,
    action: args.action,
    reason: args.reason,
    evaluatedConditions: args.conditions,
    appliedAt: args.ctx.now.toISOString(),
    resultingState: args.state,
    expectedPosition: args.expectedPosition,
  };
}
