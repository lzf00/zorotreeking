import routedGeometry from "./nagqu-g317-chengdu-routed-geometry.json";

import type { AliRoadLabel } from "./ali-road-geometry";

export const nagquG317RoadLabels: AliRoadLabel[] = [
  {
    id: "nagqu-g317",
    ref: "G317",
    name: "川藏北线",
    roadClass: "national",
    lat: 31.62,
    lng: 96.9,
    days: [1, 2],
    description: "那曲经索县、巴青、丁青、类乌齐、昌都、江达、德格和甘孜方向的主干公路。",
  },
  {
    id: "nagqu-g227",
    ref: "G227",
    name: "甘孜—炉霍—道孚通道",
    roadClass: "national",
    lat: 31.34,
    lng: 100.45,
    days: [2, 3],
    description: "从甘孜、炉霍向道孚方向转入最短成都捷径，不继续绕行翁达与马尔康。",
  },
  {
    id: "nagqu-g350",
    ref: "G350",
    name: "炉霍—丹巴—小金通道",
    roadClass: "national",
    lat: 30.95,
    lng: 101.82,
    days: [3],
    description: "串联道孚、丹巴和小金的山地通道，国庆拥堵、施工和落石会显著增加实际车时。",
  },
  {
    id: "nagqu-g4217",
    ref: "G4217",
    name: "蓉昌高速",
    roadClass: "expressway",
    lat: 31.08,
    lng: 103.48,
    days: [3],
    description: "汶川方向进入成都平原的高速通道，最终走法以当天导航和交通管制为准。",
  },
  {
    id: "nagqu-flight",
    ref: "返沪航班",
    name: "成都至上海空中转场",
    roadClass: "connector",
    lat: 31.05,
    lng: 112.8,
    days: [4],
    description: "10 月 7 日硬截止通道，只以已经出票并明确显示当日抵达上海的订单为准。",
  },
];

export const nagquG317RoutedDayGeometry = routedGeometry as unknown as Record<number, [number, number][]>;
