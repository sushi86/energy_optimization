# Aktive Morgen-Entladung: Hysterese & transparente Anzeige

**Datum:** 2026-05-02
**Bereich:** `packages/api/src/charge-plan.ts`, `packages/api/src/controller.ts`, `packages/web/app/page.tsx`

## Problem

Wenn `activeMorningDischargeMinSocPercent` z.B. auf 12% gesetzt ist, beobachtet der Nutzer Schwingen am Floor: Akku wird mit hoher Leistung bis 11–12% entladen, dann mit hoher Leistung wieder auf 12–13% geladen, dann wieder entladen — wiederholt, bis Late-Charging einsetzt.

**Ursache** (in `charge-plan.ts`):

- `willActivelyDischarge` (Zeile 180–184) ist nur `true`, solange `currentSoc > dischargeMinSoc`.
- Sobald SOC den Floor erreicht, kippt das Flag auf `false` → der Safety-Zweig auf Zeile 379 (`soc < minSocPercent && !activeDischargeEnabled`) lädt aus PV-Überschuss zurück.
- SOC steigt über Floor → `willActivelyDischarge` wieder `true` → erneute Entladung.
- Es fehlt ein Totband zwischen „Entlade-Ziel" und „Refill-Trigger".

## Lösung in einem Satz

Aus dem einzelnen `dischargeMinSoc` werden zwei Schwellen mit 1 pp Abstand: `floor` (harte Untergrenze, eingegebener Wert) und `holdTarget = floor + 1` (Entlade-Stop und Refill-Ziel). Dazwischen liegt ein Halte-Modus mit Setpoint 0 W.

## Verhalten

Eingabe in den Einstellungen: weiterhin ein einzelnes Feld („aktive Morgen-Entladung bis SOC %"), interpretiert als **Floor**. `holdTarget` ist intern fest `floor + 1`.

Drei Zustände während aktiver Morgen-Entladung:

| Zustand | Trigger | Plan-Aktion | Controller-Setpoint |
|---|---|---|---|
| **Aktiv entladen** | `soc > holdTarget` | Plan-Slot mit negativem `chargePowerW` (PV + Batterie ins Netz) | wie heute (Feed-In bis `maxAcPowerW`) |
| **Halten** | `floor ≤ soc ≤ holdTarget` | Plan-Slot mit `chargePowerW = 0`, `feedInPowerW = surplusW` | `setpointW = -feedInW`, kein Akku-Eingriff |
| **Trickle-Refill** | `soc < floor` | Plan-Slot lädt aus Überschuss, gecappt auf `preferredMaxChargeW` (5 kW), bis `holdTarget` erreicht | wie normaler Lade-Slot |

Das Totband zwischen Floor und holdTarget verhindert das Schwingen: nur wenn SOC tatsächlich unter Floor fällt, wird wieder geladen — nicht jedes Mal sobald SOC den Floor exakt erreicht.

Refill nur aus PV-Überschuss, kein Netzbezug. Floor wird nicht hart garantiert (akzeptiert) — die normale `minSocPercent`-Logik fängt abends ohnehin tiefer ab.

## Änderungen

### `charge-plan.ts`

- Neue Konstante `HOLD_BUFFER_PCT = 1` (pp Abstand).
- `dischargeMinSoc` ist weiter der Floor; neu: `holdTarget = dischargeMinSoc + HOLD_BUFFER_PCT`.
- `willActivelyDischarge`-Bedingung anpassen: `currentSoc > holdTarget` statt `> dischargeMinSoc`. Dadurch startet aktive Entladung nur, wenn klar oberhalb des Halte-Bands.
- Active-discharge-Schleife (Zeile 315–337) bricht ab bei `socSim ≤ holdTarget` (statt `≤ dischargeMinSoc`). Letzte Slots können also Akku auf genau `holdTarget` bringen, nicht darunter.
- Neuer Plan-Pfad in der Forward-Simulation (zwischen Zeile 358 und 366): wenn `activeDischargeEnabled && floor ≤ soc ≤ holdTarget && Slot vor Late-Charging`, dann `chargeW = 0` und `feedInW = surplusW` (Halte-Modus). Slot bekommt eine Markierung für die UI (siehe unten).
- Safety-Refill-Zweig (Zeile 379) bleibt grundsätzlich, aber: während aktiver Morgen-Entladung lädt er gecappt auf `preferredMaxChargeW` und bis `holdTarget` (nicht bis `minSocPercent`). Konkret: wenn `activeDischargeEnabled && soc < floor`, `chargeW = min(surplusW, preferredMaxChargeW, kWhBis(holdTarget))`.
- Sizing der Late-Charging-Need: Refill-Ausgangspunkt bleibt `dischargeMinSoc` (= floor) — kein Gewinn dadurch, dass holdTarget 1 pp höher liegt, das ist im Rauschen.
- Slot-Type erweitern um optionales Feld `dischargeState?: 'active' | 'hold' | 'trickle' | null`, gesetzt in den drei Pfaden oben. UI nutzt es zur Modus-Anzeige.

### `controller.ts`

- `isActiveDischargeSlot` (Zeile 141) wird ersetzt/ergänzt durch `dischargeState` aus dem Plan-Slot. Bestehende Logik (Feed-In bei `chargePowerW < 0`) bleibt unverändert.
- Neuer Pfad für `dischargeState === 'hold'`: `desiredChargePowerW = 0`, `feedInW = min(maxAcPowerW, currentSurplusW)`. Das ist effektiv das gleiche wie heutiges „Plan sagt Feed-In, kein Laden" — der Punkt ist, dass es **explizit** so im Plan steht, und nicht aus zufälligen Einzel-Slot-Entscheidungen entsteht.
- `effectiveMinSoc`-Berechnung (Zeile 144–149): während aktiver Morgen-Entladung wird `holdTarget` als untere Bezugsgrenze für Anzeige genutzt, der Floor selbst bleibt die harte Schwelle für Safety-Pfade.
- `ControllerDetails` erhält Felder:
  - `dischargeMode?: 'active' | 'hold' | 'trickle' | null`
  - `dischargeBand?: { floor: number; holdTarget: number }`
  - `dischargeReason?: string` (z.B. „Prognose 2,3× Bedarf — Platz für Mittags-Clipping schaffen")
  - `dischargePlanEndsAt?: string` (ISO, letzter aktiver-Discharge-Slot des Tages)

### `web/app/page.tsx` (Regler-Karte)

In der Regler-Karte (ab Zeile 1570), wenn `controller.details.dischargeMode` gesetzt:

- Modus-Badge oberhalb der Strategy-Zeile:
  - `active` → „🔋 Aktiv entladen → Halten {floor}–{holdTarget}%"
  - `hold` → „⏸ Halten {floor}–{holdTarget}% — Akku ruht"
  - `trickle` → „🐢 Sanft auffüllen auf {holdTarget}%"
- `dischargeReason` als zweite Zeile unter der Strategy.
- Wenn `dischargePlanEndsAt` gesetzt, eine Zeile „Entladung bis {HH:MM}, danach Late-Charging".
- Im `hold`-Zustand explizit „Setpoint 0 W — keine Akku-Belastung" (statt nur die Zahl).

(Emoji nur falls bestehende Karte schon Emojis nutzt — sonst Text-Tags. Vor Implementierung prüfen.)

## Tests

`packages/api/src/__tests__/charge-plan.test.ts`:

- SOC startet knapp über `holdTarget` → kein aktiver Entlade-Slot mehr (Hysterese hält Start zurück).
- SOC startet weit über `holdTarget` → aktiv entladen, Schleife stoppt bei `socSim ≈ holdTarget`, nicht darunter.
- Forward-Sim mit künstlich gedrücktem SOC = `floor - 0.5` während Discharge-Fenster → `dischargeState === 'trickle'`, `chargeW > 0`, gecappt.
- Forward-Sim mit SOC zwischen Floor und holdTarget → `dischargeState === 'hold'`, `chargeW === 0`, `feedInW === surplusW`.

`packages/api/src/__tests__/controller.test.ts`:

- Slot mit `dischargeState === 'hold'` → `desiredChargePowerW === 0`, `feedInW === min(maxAcPower, surplus)`.
- `ControllerDetails.dischargeMode` und `dischargeBand` werden korrekt durchgereicht.

## Migration / Kompatibilität

- Setting-Name und Semantik bleiben erhalten („eingegebener Wert = Floor").
- Bestehende Pläne ohne `dischargeState`-Feld funktionieren weiter (Feld optional, Controller fällt auf alte Logik zurück).
- Keine DB-Migration nötig.

## Bewusst nicht enthalten (YAGNI)

- Konfigurierbare Pufferzone — fest 1 pp.
- Trickle aus Netz — nur PV-Überschuss.
- Eigener Slow-Refill-Powerlimit — `preferredMaxChargeW` reicht; Refill-Menge ist klein genug.
- Multi-Tag-Hysterese oder zeitliche Entprellung über mehrere Slots hinweg — Plan wird sowieso periodisch neu gerechnet.
