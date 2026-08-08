import { writeFileSync } from "node:fs";

import { aliRoutedDayGeometry } from "../src/data/ali-road-geometry";

type Coordinate = [number, number];

const routeWaypoints: Record<number, Coordinate[]> = {
  3: [[29.2669, 88.8817], [29.0932, 87.6374], [29.4477, 85.0912]],
  4: [[29.4477, 85.0912], [29.7703, 84.0315], [30.0411, 83.469], [30.6735, 81.483], [30.9779, 81.2857]],
  5: [[30.9779, 81.2857], [31.3704, 80.6206], [31.6985, 79.7802], [31.4826, 79.8051], [31.4653, 79.6699], [31.4834, 79.7978], [31.4826, 79.8051]],
  6: [[31.4826, 79.8051], [31.4834, 79.7978], [32.4951, 80.1004]],
  7: [[32.4951, 80.1004], [32.3896, 81.1428], [32.0424, 81.9222], [32.3052, 84.0559]],
  8: [[32.3052, 84.0559], [32.0989, 84.8784], [31.7873, 87.2344]],
  9: [[31.7873, 87.2344], [31.8394, 89.08], [31.3922, 90.0098], [31.476, 92.0514]],
  10: [[31.476, 92.0514], [32.265, 91.6823], [33.0108, 91.6576], [34.219, 92.433], [35.417, 93.59], [35.666, 94.061], [36.407, 94.903]],
  11: [[36.407, 94.903], [36.302, 98.092], [36.79, 99.077], [36.909, 100.191], [36.6171, 101.7782]],
  12: [[36.6171, 101.7782], [36.0611, 103.8343], [36.0687, 103.7513]],
};

function perpendicularDistance(point: Coordinate, start: Coordinate, end: Coordinate) {
  const [py, px] = point;
  const [sy, sx] = start;
  const [ey, ex] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  if (dx === 0 && dy === 0) return Math.hypot(px - sx, py - sy);
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
}

function simplify(points: Coordinate[], epsilon = 0.0035): Coordinate[] {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index]!, points[0]!, points.at(-1)!);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }
  if (maxDistance <= epsilon) return [points[0]!, points.at(-1)!];
  const left = simplify(points.slice(0, splitIndex + 1), epsilon);
  const right = simplify(points.slice(splitIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

async function routeFromOsrm(points: Coordinate[]) {
  const coordinates = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, { headers: { "User-Agent": "ZoroTreeking route atlas generator" } });
  if (!response.ok) throw new Error(`OSRM returned HTTP ${response.status}`);
  const payload = await response.json() as {
    code: string;
    message?: string;
    routes?: { geometry: { coordinates: [number, number][] } }[];
  };
  if (payload.code !== "Ok" || !payload.routes?.[0]) {
    throw new Error(`OSRM route failed: ${payload.code} ${payload.message ?? ""}`);
  }
  return simplify(payload.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]));
}

const geometry: Record<number, Coordinate[]> = {
  1: [
    [31.1943, 121.327],
    [29.2963, 90.908],
    ...aliRoutedDayGeometry[1]!.slice(1),
  ],
  2: aliRoutedDayGeometry[3]!,
};

for (const day of Object.keys(routeWaypoints).map(Number)) {
  geometry[day] = await routeFromOsrm(routeWaypoints[day]!);
}

// The final leg is a road transfer to Lanzhou West followed by the main
// Lanzhou-Xi'an-Zhengzhou-Xuzhou-Nanjing-Shanghai high-speed rail corridor.
geometry[12]!.push(
  [34.377, 108.941],
  [34.759, 113.781],
  [34.267, 117.31],
  [31.968, 118.797],
  [31.1943, 121.327],
);

const output = new URL("../src/data/lhasa-lanzhou-routed-geometry.json", import.meta.url);
writeFileSync(output, `${JSON.stringify(geometry, null, 2)}\n`, "utf8");
const coordinateCount = Object.values(geometry).reduce((sum, points) => sum + points.length, 0);
console.log(`Wrote ${coordinateCount} route coordinates to ${output.pathname}`);
