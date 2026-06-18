import { XMLParser } from "fast-xml-parser";

export type GpxPoint = { lat: number; lng: number; ele?: number; time?: string };
export type GpxStats = {
  points: GpxPoint[];
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  minEle: number;
  maxEle: number;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

const R = 6371; // 地球半径 km

function haversine(a: GpxPoint, b: GpxPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function parseGpx(xml: string): GpxStats {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const data = parser.parse(xml);

  // fast-xml-parser 返回结构不可预测，全部当 any 处理
  const trks: any[] = ([] as any[]).concat(data?.gpx?.trk ?? []);
  const points: GpxPoint[] = [];
  for (const trk of trks) {
    const segs: any[] = ([] as any[]).concat(trk?.trkseg ?? []);
    for (const seg of segs) {
      const pts: any[] = ([] as any[]).concat(seg?.trkpt ?? []);
      for (const p of pts) {
        const lat = parseFloat(p["@_lat"]);
        const lng = parseFloat(p["@_lon"]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          points.push({
            lat,
            lng,
            ele: p?.ele != null ? parseFloat(p.ele) : undefined,
            time: p?.time,
          });
        }
      }
    }
  }

  let distance = 0;
  let gain = 0;
  let loss = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  // 海拔变化平滑：忽略 <3m 的抖动
  const SMOOTH_THRESHOLD = 3;
  let lastEle: number | undefined;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) distance += haversine(points[i - 1], p);
    if (p.ele != null) {
      if (p.ele < minEle) minEle = p.ele;
      if (p.ele > maxEle) maxEle = p.ele;
      if (lastEle != null) {
        const diff = p.ele - lastEle;
        if (Math.abs(diff) >= SMOOTH_THRESHOLD) {
          if (diff > 0) gain += diff;
          else loss += -diff;
          lastEle = p.ele;
        }
      } else lastEle = p.ele;
    }
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  return {
    points,
    distanceKm: Math.round(distance * 100) / 100,
    elevationGainM: Math.round(gain),
    elevationLossM: Math.round(loss),
    minEle: Number.isFinite(minEle) ? Math.round(minEle) : 0,
    maxEle: Number.isFinite(maxEle) ? Math.round(maxEle) : 0,
    bbox: { minLat, maxLat, minLng, maxLng },
  };
}
