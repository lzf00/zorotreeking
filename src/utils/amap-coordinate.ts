const PI = Math.PI;
const A = 6378245;
const EE = 0.006693421622965943;

function outsideChina(lat: number, lng: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number) {
  let value = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat;
  value += 0.2 * Math.sqrt(Math.abs(lng));
  value += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3;
  value += ((20 * Math.sin(lat * PI) + 40 * Math.sin((lat / 3) * PI)) * 2) / 3;
  value += ((160 * Math.sin((lat / 12) * PI) + 320 * Math.sin((lat * PI) / 30)) * 2) / 3;
  return value;
}

function transformLng(lng: number, lat: number) {
  let value = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat;
  value += 0.1 * Math.sqrt(Math.abs(lng));
  value += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3;
  value += ((20 * Math.sin(lng * PI) + 40 * Math.sin((lng / 3) * PI)) * 2) / 3;
  value += ((150 * Math.sin((lng / 12) * PI) + 300 * Math.sin((lng / 30) * PI)) * 2) / 3;
  return value;
}

/** Convert source WGS84 coordinates to the GCJ-02 coordinates used by AMap. */
export function wgs84ToGcj02(lat: number, lng: number): [number, number] {
  if (outsideChina(lat, lng)) return [lat, lng];

  let deltaLat = transformLat(lng - 105, lat - 35);
  let deltaLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  deltaLat = (deltaLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  deltaLng = (deltaLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lat + deltaLat, lng + deltaLng];
}

export function toAmapPosition(lat: number, lng: number): [number, number] {
  const [gcjLat, gcjLng] = wgs84ToGcj02(lat, lng);
  return [gcjLng, gcjLat];
}
