import { writeFileSync } from "node:fs";

type Coordinate = [number, number];

const waypoints: Record<number, Coordinate[]> = {
  1: [
    [31.4762, 92.0513],
    [31.8779, 93.7878],
    [31.918, 94.054],
    [31.4141, 95.5958],
    [31.2145, 96.6009],
    [31.1435, 97.1712],
  ],
  2: [
    [31.1435, 97.1712],
    [31.5018, 98.2177],
    [31.806, 98.58],
    [31.62, 99.99],
    [31.39, 100.68],
  ],
  3: [
    [31.39, 100.68],
    [30.98, 101.12],
    [30.88, 101.89],
    [31, 102.36],
    [31.47, 103.59],
    [30.5728, 104.0668],
  ],
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
  const response = await fetch(url, { headers: { "User-Agent": "ZoroTreeking G317 route atlas generator" } });
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

const geometry: Record<number, Coordinate[]> = {};
for (const day of Object.keys(waypoints).map(Number)) {
  geometry[day] = await routeFromOsrm(waypoints[day]!);
}
geometry[4] = [
  [30.5728, 104.0668],
  [30.3125, 104.441],
  [31.1943, 121.327],
];

const output = new URL("../src/data/nagqu-g317-chengdu-routed-geometry.json", import.meta.url);
writeFileSync(output, `${JSON.stringify(geometry, null, 2)}\n`, "utf8");
const coordinateCount = Object.values(geometry).reduce((sum, points) => sum + points.length, 0);
console.log(`Wrote ${coordinateCount} route coordinates to ${output.pathname}`);
