export type Zone = 'ost' | 'sued' | 'west';
export type Floor = 'EG' | 'OG';
export type WallSide = 'N' | 'S' | 'E' | 'W';

export interface CoverDef {
  id: string;          // HA entity id, z.B. 'cover.galerie_rolladen'
  zone: Zone;
  floor: Floor;
  label: string;       // UI-Anzeige
  svg: {
    x: number;         // 0..1000 viewBox-Koordinaten
    y: number;
    side: WallSide;
    widthMm: number;   // optisches Width-Mapping
  };
}

// Initial-Mapping aus der HA-YAML. SVG-Koordinaten sind Placeholders;
// werden in Frontend-Phase gemeinsam mit dem Endnutzer kalibriert.
export const COVERS: CoverDef[] = [
  // OST (Azimut 70°-145°)
  { id: 'cover.eingang_rolladen',       zone: 'ost',  floor: 'EG', label: 'Eingang',       svg: { x: 100,  y: 600, side: 'E', widthMm: 1000 } },
  { id: 'cover.kuche_vorn_rolladen',    zone: 'ost',  floor: 'EG', label: 'Küche vorn',    svg: { x: 100,  y: 200, side: 'E', widthMm: 1500 } },

  // SÜD (Azimut 110°-260°)
  { id: 'cover.kuche_garten_rolladen',          zone: 'sued', floor: 'EG', label: 'Küche Garten', svg: { x: 250, y: 50,  side: 'N', widthMm: 1500 } },
  { id: 'cover.galerie_rolladen',                zone: 'sued', floor: 'EG', label: 'Galerie',      svg: { x: 500, y: 50,  side: 'N', widthMm: 2700 } },
  { id: 'cover.shellyplus2pm_cc7b5c0f3484',     zone: 'sued', floor: 'EG', label: 'Wohnen Süd 1', svg: { x: 700, y: 50,  side: 'N', widthMm: 1100 } },
  { id: 'cover.shellyplus2pm_e465b8f35e50',     zone: 'sued', floor: 'EG', label: 'Wohnen Süd 2', svg: { x: 850, y: 50,  side: 'N', widthMm: 1100 } },

  // WEST (Azimut 215°-290°)
  { id: 'cover.westen_gross_rolladen',  zone: 'west', floor: 'EG', label: 'Wohnen West',   svg: { x: 950, y: 400, side: 'W', widthMm: 2400 } },
  { id: 'cover.west_klein_rolladen',    zone: 'west', floor: 'EG', label: 'Essen West',    svg: { x: 950, y: 250, side: 'W', widthMm: 1100 } },
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
