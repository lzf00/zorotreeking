import type { AliRoadLabel } from "./ali-road-geometry";
import { chuanxiLoopRouteDays, chuanxiLoopRoutePoints } from "./chuanxi-loop-route";

const pointById = new Map(chuanxiLoopRoutePoints.map((point) => [point.id, point]));

function lineForDay(day: number): [number, number][] {
  const ids = chuanxiLoopRouteDays.find((item) => item.day === day)?.pointIds ?? [];
  const line: [number, number][] = [];
  for (const id of ids) {
    const point = pointById.get(id);
    if (!point || point.id === "shanghai") continue;
    const last = line[line.length - 1];
    if (last && last[0] === point.lat && last[1] === point.lng) continue;
    line.push([point.lat, point.lng]);
  }
  return line;
}

export const chuanxiLoopRoutedDayGeometry: Record<number, [number, number][]> = Object.fromEntries(
  chuanxiLoopRouteDays.map((day) => [day.day, lineForDay(day.day)]),
);

export const chuanxiLoopRoadLabels: AliRoadLabel[] = [
  {
    id: "flight-in",
    ref: "沪蓉航班",
    name: "上海至成都",
    roadClass: "connector",
    lat: 30.578,
    lng: 103.947,
    days: [1],
    description: "10 月 2 日入川航班，不是自驾段。",
  },
  {
    id: "g4217",
    ref: "G4217",
    name: "汶马高速",
    roadClass: "expressway",
    lat: 31.3,
    lng: 103.45,
    days: [2, 10],
    description: "成都进出川西的主通道，10 月 3 日凌晨走、11 日回城再走。",
  },
  {
    id: "g317-west",
    ref: "G317",
    name: "鹧鸪山至阿坝",
    roadClass: "national",
    lat: 31.88,
    lng: 102.66,
    days: [2],
    description: "10 月 3 日关键垭口，天气不好就改线。",
  },
  {
    id: "s209",
    ref: "S209",
    name: "阿坝至久治",
    roadClass: "scenic",
    lat: 33.15,
    lng: 101.55,
    days: [3],
    description: "短途进青海果洛，服务点少。",
  },
  {
    id: "ganbai",
    ref: "甘白路",
    name: "甘孜至白玉",
    roadClass: "scenic",
    lat: 31.45,
    lng: 99.4,
    days: [5],
    description: "10 月 6 日经亚青寺去巴塘的风景路，弯多会车窄。",
  },
  {
    id: "g318",
    ref: "G318",
    name: "理塘稻城新都桥",
    roadClass: "national",
    lat: 30.0,
    lng: 100.27,
    days: [6, 8],
    description: "10 月 7 日和 9 日两次经过理塘—海子山。",
  },
  {
    id: "yading-road",
    ref: "亚丁路",
    name: "稻城亚丁景区",
    roadClass: "scenic",
    lat: 28.4,
    lng: 100.35,
    days: [7],
    description: "核心区需门票和观光车，禁止把五色海当驾车终点。",
  },
  {
    id: "s303",
    ref: "S303",
    name: "丹巴小金日隆",
    roadClass: "scenic",
    lat: 30.95,
    lng: 102.2,
    days: [9, 10],
    description: "新都桥经丹巴到四姑娘山，再回成都。",
  },
  {
    id: "flight-out",
    ref: "返沪航班",
    name: "成都至上海",
    roadClass: "connector",
    lat: 31.23,
    lng: 121.47,
    days: [11],
    description: "10 月 12 日返沪，不计入自驾里程。",
  },
];
