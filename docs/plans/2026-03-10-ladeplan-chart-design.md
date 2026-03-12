# Ladeplan-Chart Design

## Ziel

Neues Chart auf dem Dashboard das den geplanten Lade-/Einspeise-Verlauf pro Stunde visualisiert, mit SOC-Prognose als Overlay und geschaetztem Tagesertrag als Header. Dient als Entscheidungshilfe: feste Verguetung (EEG) vs. Boersenpreis (Direktvermarktung).

## Header / Tagesergebnis

Zeile ueber dem Chart zeigt immer beide Ertragsberechnungen nebeneinander:

```
Geschaetzter Tagesertrag: 12,3 kWh — EEG: 0,86€ | Boerse: 1,14€
```

- Feste Verguetung aus Settings (Default: 7 ct/kWh, persistiert)
- Boersenpreis aus den vorhandenen Stunden-Preisen von energy-charts.info
- Beide Werte werden immer angezeigt

## Chart

### Balken (linke Y-Achse: kW)

- **Gruen**: Geplante Einspeisung pro Stunde
- **Blau**: Geplante Ladeleistung pro Stunde
- Stunden ohne PV-Produktion werden leer dargestellt

### SOC-Linie (rechte Y-Achse: 0-100%)

- Prognostizierter SOC-Verlauf ueber den Tag
- Markierung wo 100% erreicht wird
- Startwert: aktueller SOC

### Tooltips

Beim Hover pro Stunde:
- Lade-/Einspeiseleistung (kW)
- Prognostizierter SOC (%)
- Ertrag in der Stunde (EEG + Boerse)

## Datenberechnung

### Backend (in-memory, keine Persistenz)

Pro verbleibende Stunde die Controller-Logik simulieren:
- Input: aktueller SOC, Ensemble-Forecast pro Stunde, Preise, Config
- Output pro Stunde: geplante Ladeleistung, geplante Einspeisung, prognostizierter SOC

Die Simulation nutzt die bestehende Controller-Logik (`_computeSetpoint`-Strategie) um fuer jede Stunde die Aufteilung Laden vs. Einspeisen zu bestimmen.

### Uebertragung

- Ueber WebSocket mitgesendet (alle 20s aktualisiert wie restliche Daten)
- Neues Feld im WebSocket-Payload: `chargePlan`

### Datenstruktur

```typescript
interface ChargePlanHour {
  hour: number;              // 0-23
  chargePowerW: number;      // geplante Ladeleistung
  feedInPowerW: number;      // geplante Einspeisung
  forecastW: number;         // Forecast fuer die Stunde
  estimatedSoc: number;      // prognostizierter SOC am Ende der Stunde
  revenueFixedCent: number;  // Ertrag bei fester Verguetung
  revenueMarketCent: number; // Ertrag bei Boersenpreis
}

interface ChargePlan {
  hours: ChargePlanHour[];
  totalFeedInKwh: number;
  totalRevenueFixedCent: number;
  totalRevenueMarketCent: number;
  feedInRateCentPerKwh: number;  // aktuelle Einstellung
  estimatedFull: number | null;  // Stunde wann 100% erreicht
}
```

## Settings-Erweiterung

Neues Feld in den Einstellungen:
- **Einspeiseverguetung (ct/kWh)** — Default: 7
- Persistiert in `data/config-overrides.json`
- Wird im Ladeplan-Header und Tooltips verwendet

## Position

Ganz unten auf dem Dashboard, nach dem Preis-Chart.

## Technische Entscheidungen

- **Keine Persistenz**: Alle Daten werden in-memory berechnet und bei Neustart sofort neu generiert
- **Bestehende Logik nutzen**: Die Simulation basiert auf der vorhandenen Controller-Strategie
- **WebSocket-Integration**: Gleicher Kanal wie alle anderen Live-Daten
