import { aliRoadLabels, aliRoutedDayGeometry, type AliRoadLabel } from "./ali-road-geometry";
import { aliLhasaReturnRoutedDayGeometry } from "./ali-lhasa-return-road-geometry";

const remapDays = (day: number): number[] => {
  if (day === 1) return [1];
  if (day === 13) return [12];
  if (day === 3) return [2];
  if (day === 4) return [3];
  if (day === 5) return [];
  if (day === 6) return [3, 4, 5];
  if (day === 7) return [6];
  if (day === 8) return [7];
  if (day === 9) return [8];
  if (day === 10) return [8, 9];
  if (day === 11) return [9];
  if (day === 12) return [10];
  return [];
};

const lhatseSplitIndex = 39;
const shigatseToLhatseGeometry = aliRoutedDayGeometry[4]!.slice(0, lhatseSplitIndex + 1);
const lhatseToSagaGeometry: [number, number][] = [
  [29.0932, 87.6374],
  [29.15, 87.1],
  [29.22, 86.5],
  [29.28, 86],
  [29.35, 85.6],
  [29.4, 85.3],
  [29.4477, 85.0912],
];
const taqinLocalGeometry: [number, number][] = [
  [30.9779, 81.2857],
  [30.92, 81.36],
  [30.6735, 81.483],
  [30.82, 81.38],
  [30.9779, 81.2857],
  [31.02, 81.3],
  [30.9779, 81.2857],
];
const pangongRoundtripGeometry: [number, number][] = [
  [32.4951, 80.1004],
  [32.7, 79.95],
  [33.0, 79.85],
  [33.25, 79.78],
  [33.3875, 79.7314],
  [33.48, 79.45],
  [33.56, 79.18],
  [33.48, 79.45],
  [33.3875, 79.7314],
  [33.0, 79.85],
  [32.4951, 80.1004],
];

export const aliPermitBypassRoadLabels: AliRoadLabel[] = [
  ...aliRoadLabels
    .map((road) => {
      const days = Array.from(new Set(road.days.flatMap(remapDays)));
      if (road.id === "zanda-road") {
        return {
          ...road,
          id: `permit-bypass-${road.id}`,
          days: days.filter((day) => day === 6),
        };
      }
      return {
        ...road,
        id: `permit-bypass-${road.id}`,
        days,
      };
    })
    .filter((road) => road.days.length > 0),
  {
    id: "permit-bypass-pangong",
    ref: "G219",
    name: "狮泉河至班公湖",
    roadClass: "scenic",
    lat: 33.2,
    lng: 79.7,
    days: [7],
    description: "10 月 2 日狮泉河往返日土、班公湖的机动支线，可整日取消。",
  },
  {
    id: "permit-bypass-flight",
    ref: "返沪航班",
    name: "拉萨至上海空中转场",
    roadClass: "connector",
    lat: 30.25,
    lng: 106.5,
    days: [12],
    description: "团队 10 月 7 日返沪硬截止通道，优先采用已出票的直飞航班。",
  },
];

export const aliPermitBypassRoutedDayGeometry: Record<number, [number, number][]> = {
  1: aliLhasaReturnRoutedDayGeometry[1]!,
  2: aliLhasaReturnRoutedDayGeometry[2]!,
  3: [...shigatseToLhatseGeometry, ...lhatseToSagaGeometry],
  4: aliRoutedDayGeometry[6]!,
  5: taqinLocalGeometry,
  6: [...aliRoutedDayGeometry[7]!, ...aliRoutedDayGeometry[8]!],
  7: pangongRoundtripGeometry,
  8: aliLhasaReturnRoutedDayGeometry[8]!,
  9: aliLhasaReturnRoutedDayGeometry[9]!,
  10: aliLhasaReturnRoutedDayGeometry[10]!,
  11: aliLhasaReturnRoutedDayGeometry[11]!,
  12: aliLhasaReturnRoutedDayGeometry[12]!,
};
