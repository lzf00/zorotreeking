import { aliRoadLabels, aliRoutedDayGeometry, type AliRoadLabel } from "./ali-road-geometry";

const remapDays = (day: number): number[] => {
  if (day === 1) return [1];
  if (day === 13) return [12];
  if (day === 3) return [2];
  if (day === 4) return [3];
  if (day === 5) return [4, 5];
  if (day === 6) return [6];
  if (day === 7 || day === 8) return [7];
  if (day === 9) return [8];
  if (day === 10) return [8, 9];
  if (day === 11) return [9];
  if (day === 12) return [10];
  return [];
};

const everestScenicSplitIndex = 55;
const dongcoSplitIndex = 14;
const everestEntryGeometry = aliRoutedDayGeometry[5]!.slice(0, everestScenicSplitIndex + 1);
const everestToSagaGeometry = aliRoutedDayGeometry[5]!.slice(everestScenicSplitIndex);
const shiquanheToDongcoGeometry = [
  ...aliRoutedDayGeometry[9]!,
  ...aliRoutedDayGeometry[10]!.slice(1, dongcoSplitIndex + 1),
];
const dongcoToBaingoinGeometry = [
  ...aliRoutedDayGeometry[10]!.slice(dongcoSplitIndex),
  ...aliRoutedDayGeometry[11]!.slice(1),
];

export const aliLhasaReturnRoadLabels: AliRoadLabel[] = [
  ...aliRoadLabels.map((road) => {
    return {
      ...road,
      id: `lhasa-return-${road.id}`,
      days: Array.from(new Set(road.days.flatMap(remapDays))),
    };
  }).filter((road) => road.days.length > 0),
  {
    id: "lhasa-return-kunsha-flight",
    ref: "昆莎航班",
    name: "阿里昆莎至拉萨或成都",
    roadClass: "connector",
    lat: 31.95,
    lng: 81.2,
    days: [8],
    description: "朋友在狮泉河分流后的首选空中退出通道，具体日期、班次和席位以开售订单为准。",
  },
  {
    id: "lhasa-return-flight",
    ref: "返沪航班",
    name: "拉萨至上海空中转场",
    roadClass: "connector",
    lat: 30.25,
    lng: 106.5,
    days: [12],
    description: "团队 10 月 7 日返沪硬截止通道，优先采用已出票的直飞航班。",
  },
];

export const aliLhasaReturnRoutedDayGeometry: Record<number, [number, number][]> = {
  1: aliRoutedDayGeometry[1]!,
  2: aliRoutedDayGeometry[3]!,
  3: aliRoutedDayGeometry[4]!,
  4: everestEntryGeometry,
  5: everestToSagaGeometry,
  6: aliRoutedDayGeometry[6]!,
  7: [
    ...aliRoutedDayGeometry[7]!,
    ...aliRoutedDayGeometry[8]!.slice(1),
  ],
  8: shiquanheToDongcoGeometry,
  9: dongcoToBaingoinGeometry,
  10: aliRoutedDayGeometry[12]!,
  11: [
    [29.652, 91.1721],
    [29.645, 91.12],
    [29.652, 91.1721],
  ],
  12: [
    ...aliRoutedDayGeometry[13]!,
    [29.2963, 90.908],
    [30.5728, 104.0668],
    [31.1943, 121.327],
  ],
};
