# Design: forecast.solar als zweiter PV-Forecast-Anbieter

## Ziel

Genauigkeit der PV-Prognose verbessern durch Ensemble aus VRM-Forecast und forecast.solar.

## PV-Anlagen-Konfiguration

- Neue Einstellungen im Frontend (Settings-Seite): Neigung, Azimut, kWp, Latitude, Longitude
- Defaults: 35°, +2°, 17.8 kWp, 51.22731665478406, 9.311660517083372
- Gespeichert in JSON-Datei auf dem Server: `data/settings.json`
- Neue API-Endpoints: `GET /api/settings/pv-system` und `PUT /api/settings/pv-system`
- Validierung: kWp > 0, Neigung 0-90°, Azimut -180 bis +180°, Lat/Lon gültige Koordinaten

## forecast.solar Service

- Neuer Service: `forecast-solar-service.ts`
- API-Aufruf: `GET https://api.forecast.solar/estimate/:kwp/:dec/:az/:lat/:lon`
- Parst Response in bestehendes `ForecastHour[]`-Format
- Refresh alle 30 Minuten (synchron mit VRM)
- Rate-Limit: max 12 Requests/Stunde (kostenloser Tier)
- Fehlerbehandlung: Bei Fehler wird nur VRM genutzt, Warnung geloggt

## Ensemble-Logik

- Berechnet stündlichen Durchschnitt aus VRM + forecast.solar
- Fallback: Wenn nur ein Anbieter Daten liefert, werden dessen Werte direkt genutzt
- Der Ensemble-Forecast ersetzt den bisherigen VRM-Forecast als Input für Controller-Optimierung
- Ensemble-Berechnung im Controller oder als separate Funktion

## Frontend

- Forecast-Chart zeigt 3 Kurven: VRM (gestrichelt), forecast.solar (gestrichelt), Ensemble (solid) + Actual
- Settings-Seite bekommt neuen Abschnitt "PV-Anlage" mit konfigurierbaren Werten:
  - Latitude, Longitude
  - Neigung (°)
  - Azimut (°)
  - kWp

## Kein Breaking Change

- Ohne PV-System-Konfiguration verhält sich alles wie bisher (nur VRM)
- forecast.solar wird aktiviert sobald PV-System-Daten vorhanden sind
- Bestehende Env-Vars und VRM-Integration bleiben unverändert
