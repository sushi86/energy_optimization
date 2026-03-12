/**
 * Strompreisrechner für EAM Netzgebiet (Niedenstein, 34305)
 * Berechnet den Bruttopreis anhand des aktuellen EPEX Day-Ahead Börsenpreises
 * und der aktuellen Uhrzeit (Modul 3 Netzentgelte).
 *
 * Alle mit [ÄNDERBAR] markierten Werte können sich jährlich ändern.
 * Quellen: EAM Preisblatt 2026, Bundesnetzagentur, Übertragungsnetzbetreiber
 */

// ---------------------------------------------------------------------------
// [ÄNDERBAR] EAM Netzentgelte 2026 (gültig 01.01.2026 – 31.12.2026)
// Quelle: EAM Netz GmbH Preisblatt Strom 2026
// Modul 3 – zeitvariable Netzentgelte (nur in Kombination mit Modul 1 wählbar)
// ---------------------------------------------------------------------------
const NETZENTGELT = {
  NT: 1.64,   // Niedertarif:   23:00–06:00 und 11:00–15:00 Uhr
  ST: 5.48,   // Standardtarif: 06:00–11:00, 15:00–17:00 und 22:00–23:00 Uhr
  HT: 10.52,  // Hochtarif:     17:00–22:00 Uhr
} as const;

// ---------------------------------------------------------------------------
// [ÄNDERBAR] Bundesweit einheitliche Umlagen 2026
// Quelle: Übertragungsnetzbetreiber (50Hertz, Amprion, TenneT, TransnetBW)
// ---------------------------------------------------------------------------
const UMLAGEN = {
  aufschlagBesondereNetznutzung: 1.559, // ehem. §19 StromNEV-Umlage
  offshoreNetzumlage: 0.941,
  kwkgUmlage: 0.446,
};

// ---------------------------------------------------------------------------
// [ÄNDERBAR] Steuern und Abgaben 2026
// ---------------------------------------------------------------------------
const ABGABEN = {
  stromsteuer: 2.050,         // bundesweit einheitlich, §3 StromStG
  konzessionsabgabe: 1.320,   // [ÄNDERBAR] abhängig von Gemeindegröße!
                               // Niedenstein (~8.000 Einw.) → KAV-Satz für
                               // Gemeinden unter 25.000 Einwohnern: ~1,32 ct/kWh
  mehrwertsteuer: 0.19,        // 19% auf alle Bestandteile (§12 UStG)
};

// ---------------------------------------------------------------------------
// [ÄNDERBAR] Lieferantenmarge (abhängig vom gewählten Stromanbieter)
// Typisch: Tibber ~0,5 ct, andere Anbieter 0,5–2 ct
// ---------------------------------------------------------------------------
const LIEFERANTENMARGE = 0.7; // ct/kWh netto (Annahme)

// ---------------------------------------------------------------------------
// Hilfsfunktion: Welches Netzentgelt gilt zur aktuellen Uhrzeit?
// EAM Modul 3 Zeitfenster 2026
// ---------------------------------------------------------------------------
export type Tarifstufe = "NT" | "ST" | "HT";

export function getTarifstufe(date: Date): Tarifstufe {
  const stunde = date.getHours();

  // NT: 23:00–06:00 Uhr (Nacht)
  if (stunde >= 23 || stunde < 6) return "NT";

  // ST: 06:00–11:00 Uhr (Morgen)
  if (stunde >= 6 && stunde < 11) return "ST";

  // NT: 11:00–15:00 Uhr (Mittag – günstig wegen PV-Überschuss)
  if (stunde >= 11 && stunde < 15) return "NT";

  // ST: 15:00–17:00 Uhr (Nachmittag)
  if (stunde >= 15 && stunde < 17) return "ST";

  // HT: 17:00–22:00 Uhr (Abend-Peak)
  if (stunde >= 17 && stunde < 22) return "HT";

  // ST: 22:00–23:00 Uhr
  return "ST";
}

// ---------------------------------------------------------------------------
// Hauptfunktion: Gesamtstrompreis berechnen
// ---------------------------------------------------------------------------
export interface StrompreisErgebnis {
  boersenstrompreis: number;       // ct/kWh – Eingabe (EPEX Day-Ahead)
  tarifstufe: Tarifstufe;          // NT / ST / HT
  netzentgelt: number;             // ct/kWh netto
  umlagenGesamt: number;           // ct/kWh netto
  stromsteuer: number;             // ct/kWh netto
  konzessionsabgabe: number;       // ct/kWh netto
  lieferantenmarge: number;        // ct/kWh netto
  summeNetto: number;              // ct/kWh vor MwSt.
  mehrwertsteuer: number;          // ct/kWh MwSt.-Anteil
  gesamtpreisbrutto: number;       // ct/kWh inkl. MwSt. – Endpreis
}

export function berechneStrompreis(
  boersenstrompreisCtKwh: number,
  zeitpunkt: Date = new Date()
): StrompreisErgebnis {
  const tarifstufe = getTarifstufe(zeitpunkt);
  const netzentgelt = NETZENTGELT[tarifstufe];

  const umlagenGesamt =
    UMLAGEN.aufschlagBesondereNetznutzung +
    UMLAGEN.offshoreNetzumlage +
    UMLAGEN.kwkgUmlage;

  const summeNetto =
    boersenstrompreisCtKwh +
    LIEFERANTENMARGE +
    netzentgelt +
    umlagenGesamt +
    ABGABEN.stromsteuer +
    ABGABEN.konzessionsabgabe;

  const mehrwertsteuer = summeNetto * ABGABEN.mehrwertsteuer;
  const gesamtpreisbrutto = summeNetto + mehrwertsteuer;

  return {
    boersenstrompreis: boersenstrompreisCtKwh,
    tarifstufe,
    netzentgelt,
    umlagenGesamt,
    stromsteuer: ABGABEN.stromsteuer,
    konzessionsabgabe: ABGABEN.konzessionsabgabe,
    lieferantenmarge: LIEFERANTENMARGE,
    summeNetto,
    mehrwertsteuer,
    gesamtpreisbrutto,
  };
}
