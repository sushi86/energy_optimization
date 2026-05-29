export type Zone = 'ost' | 'sued' | 'west';
export type Floor = 'EG' | 'OG';
export type WallSide = 'N' | 'S' | 'E' | 'W';

export interface CoverDef {
  id: string;
  zone: Zone;
  floor: Floor;
  label: string;
  // SVG coords in mm, matching the architect plan (viewBox 0 0 1312 997).
  // `side` is the wall side in the SVG: N=top (=SÜD), S=bottom (=NORD),
  // E=left (=OST), W=right (=WEST).
  svg: { x: number; y: number; side: WallSide; widthMm: number };
}

export const COVERS: CoverDef[] = [
  // EG ───────────────────────────────────────────────────────────────────
  // OST (linke Außenwand)
  { id: 'cover.kuche_vorn_rolladen', zone: 'ost', floor: 'EG', label: 'Küche vorn',
    svg: { x: 0, y: 1100, side: 'E', widthMm: 1450 } },
  { id: 'cover.eingang_rolladen', zone: 'ost', floor: 'EG', label: 'Eingang',
    svg: { x: 0, y: 6300, side: 'E', widthMm: 1100 } },

  // SÜD (obere Außenwand)
  { id: 'cover.kuche_garten_rolladen', zone: 'sued', floor: 'EG', label: 'Küche Garten',
    svg: { x: 1700, y: 0, side: 'N', widthMm: 1980 } },
  { id: 'cover.galerie_rolladen', zone: 'sued', floor: 'EG', label: 'Galerie',
    svg: { x: 5800, y: 0, side: 'N', widthMm: 2730 } },
  { id: 'cover.shellyplus2pm_cc7b5c0f3484', zone: 'sued', floor: 'EG', label: 'Wohnen Süd 1',
    svg: { x: 9400, y: 0, side: 'N', widthMm: 1105 } },
  { id: 'cover.shellyplus2pm_e465b8f35e50', zone: 'sued', floor: 'EG', label: 'Wohnen Süd 2',
    svg: { x: 11400, y: 0, side: 'N', widthMm: 1100 } },

  // WEST (rechte Außenwand)
  { id: 'cover.west_klein_rolladen', zone: 'west', floor: 'EG', label: 'Essen West',
    svg: { x: 13120, y: 1900, side: 'W', widthMm: 1100 } },
  { id: 'cover.westen_gross_rolladen', zone: 'west', floor: 'EG', label: 'Wohnen West',
    svg: { x: 13120, y: 4800, side: 'W', widthMm: 2350 } },

  // OG ───────────────────────────────────────────────────────────────────
  // OST (linke Außenwand) — Garderobe + Schlafzimmer
  { id: 'cover.ankleide_rolladen', zone: 'ost', floor: 'OG', label: 'Ankleide',
    svg: { x: 0, y: 5400, side: 'E', widthMm: 605 } },
  { id: 'cover.schlafzimmer_rolladen', zone: 'ost', floor: 'OG', label: 'Schlafzimmer',
    svg: { x: 0, y: 7700, side: 'E', widthMm: 1105 } },

  // WEST (rechte Außenwand) — Pauls + Emils Zimmer
  { id: 'cover.paul_rolladen', zone: 'west', floor: 'OG', label: 'Pauls Zimmer',
    svg: { x: 13120, y: 2400, side: 'W', widthMm: 1730 } },
  { id: 'cover.emil_rolladen', zone: 'west', floor: 'OG', label: 'Emils Zimmer',
    svg: { x: 13120, y: 7400, side: 'W', widthMm: 1730 } },
];

// Statische Fenster ohne steuerbaren Rolladen — nur visuell auf dem Plan.
export interface StaticWindowDef {
  floor: Floor;
  label: string;
  svg: { x: number; y: number; side: WallSide; widthMm: number };
}

export const STATIC_WINDOWS: StaticWindowDef[] = [
  // OG Büro Fluchtfenster (Rolladen vorhanden, aber nicht über HA steuerbar)
  { floor: 'OG', label: 'Büro Fluchtfenster',
    svg: { x: 0, y: 2400, side: 'E', widthMm: 1480 } },
  // OG Süd-Lichtband (FIX, kein Rolladen) über Luftraum
  { floor: 'OG', label: 'Luftraum-Lichtband',
    svg: { x: 5200, y: 0, side: 'N', widthMm: 2730 } },
];

export const ZONE_AZIMUTH_RANGES: Record<Zone, { from: number; to: number }> = {
  ost:  { from: 70,  to: 145 },
  sued: { from: 110, to: 260 },
  west: { from: 215, to: 290 },
};

export function coversInZone(zone: Zone): CoverDef[] {
  return COVERS.filter((c) => c.zone === zone);
}

export function coverById(id: string): CoverDef | undefined {
  return COVERS.find((c) => c.id === id);
}
