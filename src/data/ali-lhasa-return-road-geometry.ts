import { aliRoadLabels, aliRoutedDayGeometry, type AliRoadLabel } from "./ali-road-geometry";

const remapDay = (day: number) => {
  if (day === 1) return 1;
  if (day === 13) return 12;
  if (day >= 3 && day <= 12) return day - 1;
  return undefined;
};
export const aliLhasaReturnRoadLabels: AliRoadLabel[] = [
  ...aliRoadLabels.map((road) => ({
    ...road,
    id: `lhasa-return-${road.id}`,
    days: road.days.map(remapDay).filter((day): day is number => day != null),
  })).filter((road) => road.days.length > 0),
  {
    id: "lhasa-return-kunsha-flight",
    ref: "昆莎航班",
    name: "阿里昆莎至拉萨或成都",
    roadClass: "connector",
    lat: 31.95,
    lng: 81.2,
    days: [7],
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
  4: aliRoutedDayGeometry[5]!,
  5: aliRoutedDayGeometry[6]!,
  6: aliRoutedDayGeometry[7]!,
  7: aliRoutedDayGeometry[8]!,
  8: aliRoutedDayGeometry[9]!,
  9: aliRoutedDayGeometry[10]!,
  10: aliRoutedDayGeometry[11]!,
  11: aliRoutedDayGeometry[12]!,
  12: [
    ...aliRoutedDayGeometry[13]!,
    [29.2963, 90.908],
    [30.5728, 104.0668],
    [31.1943, 121.327],
  ],
};
