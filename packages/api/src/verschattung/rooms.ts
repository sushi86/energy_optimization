import type { Floor } from './covers.js';

export interface RoomDef {
  id: string;
  floor: Floor;
  label: string;
  tempEntity: string;
  humidityEntity?: string;
  // SVG-Koordinaten in mm (viewBox 0 0 1312 997) — Position des Temp-Badges
  // im Raum. Mittig oder leicht nach oben versetzt, nach Wahl pro Raum.
  svg: { x: number; y: number };
}

export const ROOMS: RoomDef[] = [
  // EG — ein Raum mit Temp+Luftfeuchte (Sensor sitzt physisch in der Diele)
  {
    id: 'eg',
    floor: 'EG',
    label: 'Erdgeschoss',
    tempEntity: 'sensor.timmerflotte_temp_hmd_sensor_temperatur_3',
    humidityEntity: 'sensor.timmerflotte_temp_hmd_sensor_luftfeuchtigkeit_3',
    svg: { x: 2200, y: 5200 },
  },

  // OG — drei Sensoren (Büro, Pauls Zimmer, Emils Zimmer)
  {
    id: 'og_buero',
    floor: 'OG',
    label: 'Büro',
    tempEntity: 'sensor.alpstuga_air_quality_monitor_temperatur',
    svg: { x: 2100, y: 1800 },
  },
  {
    id: 'og_paul',
    floor: 'OG',
    label: 'Pauls Zimmer',
    tempEntity: 'sensor.timmerflotte_temp_hmd_sensor_temperatur',
    humidityEntity: 'sensor.timmerflotte_temp_hmd_sensor_luftfeuchtigkeit',
    svg: { x: 11000, y: 1800 },
  },
  {
    id: 'og_emil',
    floor: 'OG',
    label: 'Emils Zimmer',
    tempEntity: 'sensor.timmerflotte_temp_hmd_sensor_temperatur_2',
    humidityEntity: 'sensor.timmerflotte_temp_hmd_sensor_luftfeuchtigkeit_2',
    svg: { x: 11000, y: 7800 },
  },
];
