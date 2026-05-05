import SunCalc from 'suncalc';

export interface SunPosition {
  azimuthDeg: number;   // 0..360, 0 = North, clockwise
  elevationDeg: number; // -90..+90
}

export function computeSunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const { azimuth, altitude } = SunCalc.getPosition(date, latitude, longitude);
  const radToDeg = 180 / Math.PI;
  let compass = azimuth * radToDeg + 180;
  if (compass < 0) compass += 360;
  if (compass >= 360) compass -= 360;
  return {
    azimuthDeg: compass,
    elevationDeg: altitude * radToDeg,
  };
}
