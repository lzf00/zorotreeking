import { writeFileSync } from "node:fs";

type Coordinate = [number, number];

const coreWaypoints: Record<number, Coordinate[]> = {
  5: [
    [30.9779, 81.2857],
    [31.3704, 80.6206],
    [31.6985, 79.7802],
    [31.4826, 79.8051],
    [31.4653, 79.6699],
    [31.4834, 79.7978],
    [32.4951, 80.1004],
  ],
  6: [[32.4951, 80.1004], [30.7742, 81.6129], [31.4964, 82.3342]],
  7: [[31.4964, 82.3342], [31.275, 83.1824], [31.0189, 85.1501]],
  8: [[31.0189, 85.1501], [31.3425, 86.7556], [31.7873, 87.2344]],
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
  const response = await fetch(url, { headers: { "User-Agent": "ZoroTreeking central route atlas generator" } });
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

const core: Record<number, Coordinate[]> = {};
for (const day of Object.keys(coreWaypoints).map(Number)) {
  core[day] = await routeFromOsrm(coreWaypoints[day]!);
}

const chengduTail: Record<number, Coordinate[]> = {
  10: await routeFromOsrm([[31.476, 92.0514], [29.6542, 91.1173], [29.2963, 90.908]]),
  11: [[30.5728, 104.0668], [30.6288, 104.1411]],
  12: [
    [30.6288, 104.1411],
    [34.377, 108.941],
    [34.759, 113.781],
    [34.267, 117.31],
    [31.968, 118.797],
    [31.1943, 121.327],
  ],
};
chengduTail[10]!.push([30.3125, 104.441], [30.5728, 104.0668]);

const outputs: [URL, Record<number, Coordinate[]>][] = [
  [new URL("../src/data/ali-central-core-routed-geometry.json", import.meta.url), core],
  [new URL("../src/data/ali-central-chengdu-tail-routed-geometry.json", import.meta.url), chengduTail],
];

for (const [output, geometry] of outputs) {
  writeFileSync(output, `${JSON.stringify(geometry, null, 2)}\n`, "utf8");
  const coordinateCount = Object.values(geometry).reduce((sum, points) => sum + points.length, 0);
  console.log(`Wrote ${coordinateCount} route coordinates to ${output.pathname}`);
}

