import {
  aliRouteDays,
  aliRoutePoints,
  type AliRouteDay,
  type AliRoutePoint,
} from "./ali-route";

const friendExitPoints: AliRoutePoint[] = [
  {
    id: "kunsha-airport",
    name: "阿里昆莎机场",
    shortName: "昆莎机场",
    kind: "airport",
    lat: 32.1013,
    lng: 80.0563,
    elevationM: 4274,
    detail: "朋友提前返沪的首选分流机场，距狮泉河镇规划道路约 54 公里。团队 10 月 2 日抵达狮泉河后，朋友可于 10 月 3 日单独前往机场。",
    services: "拉萨航班、部分成都航班、机场接驳以开售结果为准",
  },
  {
    id: "purang-airport",
    name: "阿里普兰机场",
    shortName: "普兰机场",
    kind: "airport",
    lat: 30.3981,
    lng: 81.1335,
    elevationM: 4250,
    detail: "更早的备用退出点，从塔钦规划道路约 93 公里。只有昆莎航班无票且已落实独立车辆和普兰航班时才采用。",
    services: "拉萨方向航班、机场接驳和道路状态以开售及当天信息为准",
  },
  {
    id: "shanghai",
    name: "上海虹桥或浦东机场",
    shortName: "上海",
    kind: "city",
    lat: 31.1943,
    lng: 121.327,
    elevationM: 4,
    detail: "团队与提前返程朋友的共同硬截止终点；只把已经出票且明确显示日期和到达机场的订单视为有效返程。",
    services: "机场、高铁、轨道交通、酒店、医疗",
  },
];
export const aliLhasaReturnRoutePoints: AliRoutePoint[] = [
  ...aliRoutePoints.map((point) => {
    if (point.id === "gonggar-airport") {
      return {
        ...point,
        detail: "9 月 26 日落地取车与 10 月 7 日返沪的共同节点。取车时完成车况、备胎、防滑链、救援和同城还车规则核对。",
      };
    }
    if (point.id === "lhasa") {
      return {
        ...point,
        detail: "新版阿里大环线的取还车城市：9 月 26 日完成适应和补给，10 月 6 日下午或晚上回到这里完成还车。",
      };
    }
    if (point.id === "shiquanhe") {
      return {
        ...point,
        detail: "阿里地区综合补给中心，也是朋友 10 月 5 日前返沪的最佳分流城市；昆莎机场位于镇区西南方向。",
      };
    }
    return { ...point };
  }),
  ...friendExitPoints,
];

const copiedDrivingDays = aliRouteDays.slice(2, 12).map((day) => ({
  ...day,
  day: day.day - 1,
  pointIds: [...day.pointIds],
  highlights: [...day.highlights],
}));

const shiquanheDayIndex = copiedDrivingDays.findIndex((day) => day.date === "10.02");
if (shiquanheDayIndex >= 0) {
  const day = copiedDrivingDays[shiquanheDayIndex]!;
  copiedDrivingDays[shiquanheDayIndex] = {
    ...day,
    highlights: [...day.highlights, "朋友昆莎机场分流"],
    decision: `${day.decision} 需要 10 月 5 日前返沪的朋友当晚留在狮泉河，次日不再随车进入改则方向。`,
  };
}

export const aliLhasaReturnRouteDays: AliRouteDay[] = [
  {
    day: 1,
    date: "09.26",
    title: "抵达贡嘎机场 → 拉萨取车与适应",
    distance: "机场至拉萨约 65 km",
    driving: "约 1–1.5 小时（不含航班和验车）",
    roads: "机场高速 / 拉萨城市道路",
    pointIds: ["gonggar-airport", "lhasa"],
    highlights: ["落地取车", "车辆留档", "高原适应", "全程物资补给"],
    supply: "在拉萨一次性补齐边境通行证材料、氧气、现金、离线地图、水粮和保暖装备，车辆拍照并核对轮胎、备胎和救援范围。",
    overnight: "拉萨市区，选择有电梯、停车方便并靠近医院的住宿。",
    risk: "落地当天最需要防范高反、饮酒、久热水澡和过度兴奋；不要把城市游览排进取车适应日。",
    decision: "静息状态仍明显不适、血氧持续异常或车辆关键装备不齐，第二天不离开拉萨，宁可缩短阿里行程。",
  },
  ...copiedDrivingDays,
  {
    day: 12,
    date: "10.07",
    title: "拉萨 → 贡嘎机场 → 上海｜当日必须抵达",
    distance: "机场段约 65 km + 航班转场",
    driving: "约 1–1.5 小时（不含航班）",
    roads: "机场高速 / 拉萨至上海航班",
    pointIds: ["lhasa", "gonggar-airport", "shanghai"],
    highlights: ["还车凭证复核", "贡嘎机场", "拉萨直飞上海", "返沪硬截止"],
    supply: "优先在 10 月 6 日晚完成加油、洗车和还车；10 月 7 日只保留酒店至机场的人员与行李转场。",
    overnight: "当晚抵达上海。",
    risk: "国庆返程和高原天气可能造成航变，未出票联程、候补和紧张中转都不能视为有效返沪方案。",
    decision: "优先购买拉萨直飞上海且可退改的航班；若 10 月 6 日已有确定晚班并顺利还车，可提前一晚离藏增加缓冲。",
  },
];
