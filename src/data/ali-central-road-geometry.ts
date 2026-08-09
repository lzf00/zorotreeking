import chengduTailGeometry from "./ali-central-chengdu-tail-routed-geometry.json";
import centralCoreGeometry from "./ali-central-core-routed-geometry.json";
import lhasaLanzhouGeometry from "./lhasa-lanzhou-routed-geometry.json";

import type { AliRoadLabel } from "./ali-road-geometry";

type RoutedGeometry = Record<number, [number, number][]>;

const sharedLabels: AliRoadLabel[] = [
  {
    id: "central-airport-expressway",
    ref: "机场高速",
    name: "拉萨机场高速",
    roadClass: "expressway",
    lat: 29.422,
    lng: 90.779,
    days: [1],
    description: "贡嘎机场取车后前往拉萨城区的首段道路。",
  },
  {
    id: "central-g349",
    ref: "G349",
    name: "国道349",
    roadClass: "national",
    lat: 28.873,
    lng: 90.376,
    days: [2],
    description: "拉萨经羊卓雍措、浪卡子、卡若拉与江孜前往日喀则。",
  },
  {
    id: "central-g318",
    ref: "G318",
    name: "国道318",
    roadClass: "national",
    lat: 29.075,
    lng: 87.82,
    days: [2, 3],
    description: "江孜、日喀则与拉孜方向的高原主干公路。",
  },
  {
    id: "central-g219",
    ref: "G219",
    name: "国道219",
    roadClass: "national",
    lat: 29.67,
    lng: 84.37,
    days: [3, 4, 5, 6],
    description: "萨嘎、仲巴、塔钦、札达、狮泉河与霍尔方向的阿里南线主轴。",
  },
  {
    id: "central-g565",
    ref: "G565",
    name: "札达方向公路",
    roadClass: "connector",
    lat: 31.34,
    lng: 79.81,
    days: [5],
    description: "串联门士、札达土林、古格遗址与狮泉河的连接道路。",
  },
  {
    id: "central-s302",
    ref: "S302",
    name: "措勤—亚热公路",
    roadClass: "national",
    lat: 31.46,
    lng: 82.55,
    days: [6, 7],
    description: "霍尔、亚热和仁多方向的重要中线通道，施工、养护和通行状态须按当天官方信息复核。",
  },
  {
    id: "central-track",
    ref: "阿里中线",
    name: "仁多—措勤—文布南村通道",
    roadClass: "scenic",
    lat: 31.14,
    lng: 85.85,
    days: [7, 8],
    description: "穿过仁多、措勤、当惹雍措与文布南村的规划通道，不代表雨雪后或施工期间必然可通。",
  },
  {
    id: "central-g317",
    ref: "G317",
    name: "国道317",
    roadClass: "national",
    lat: 31.63,
    lng: 89.72,
    days: [9],
    description: "尼玛经班戈方向衔接那曲的藏北主干道路组合。",
  },
  {
    id: "central-g109",
    ref: "G109",
    name: "青藏公路",
    roadClass: "national",
    lat: 31.94,
    lng: 91.86,
    days: [9, 10],
    description: "那曲与安多、格尔木或拉萨之间的青藏公路主轴。",
  },
];

export const aliCentralLanzhouRoadLabels: AliRoadLabel[] = [
  ...sharedLabels,
  {
    id: "central-lanzhou-g6",
    ref: "G6",
    name: "京藏高速",
    roadClass: "expressway",
    lat: 36.41,
    lng: 99.03,
    days: [11, 12],
    description: "格尔木经都兰、茶卡、西宁至兰州的返程高速主轴。",
  },
  {
    id: "central-lanzhou-rail",
    ref: "沪兰高铁",
    name: "兰州西至上海铁路通道",
    roadClass: "connector",
    lat: 34.37,
    lng: 112.2,
    days: [12],
    description: "最终以 12306 实际开售车次和当日抵沪时间为准。",
  },
];

export const aliCentralChengduRoadLabels: AliRoadLabel[] = [
  ...sharedLabels,
  {
    id: "central-chengdu-flight",
    ref: "空中转场",
    name: "拉萨—成都航班",
    roadClass: "connector",
    lat: 30.05,
    lng: 97.38,
    days: [10],
    description: "为守住 10 月 7 日返沪硬截止而采用的安全转场，具体航班须在开售后确认。",
  },
  {
    id: "central-chengdu-rail",
    ref: "成沪通道",
    name: "成都至上海铁路或航班通道",
    roadClass: "connector",
    lat: 33.62,
    lng: 113.42,
    days: [12],
    description: "10 月 7 日返沪主通道，铁路和航班均只以已出票且当日抵达的订单为准。",
  },
];

export const aliCentralLanzhouRoutedDayGeometry: RoutedGeometry = {
  ...(lhasaLanzhouGeometry as unknown as RoutedGeometry),
  ...(centralCoreGeometry as unknown as RoutedGeometry),
};

export const aliCentralChengduRoutedDayGeometry: RoutedGeometry = {
  ...(lhasaLanzhouGeometry as unknown as RoutedGeometry),
  ...(centralCoreGeometry as unknown as RoutedGeometry),
  ...(chengduTailGeometry as unknown as RoutedGeometry),
};

