import {
  aliLhasaReturnDailyPlanning,
  aliLhasaReturnRouteDays,
  aliLhasaReturnRoutePoints,
} from "./ali-lhasa-return-route";
import type { AliRouteDailyPlanning, AliRouteDay, AliRoutePoint } from "./ali-route";

const everestDetourPointIds = new Set(["tingri", "gawula", "rongbuk"]);

const pangongPoints: AliRoutePoint[] = [
  {
    id: "rutog",
    name: "日土县城",
    shortName: "日土",
    kind: "city",
    lat: 33.3875,
    lng: 79.7314,
    elevationM: 4270,
    detail: "班公湖往返的补给和检查节点。只走开放公路；检查站可能核对电子证前往地是否含日土县。",
    services: "餐饮、加油、有限住宿",
  },
  {
    id: "pangong",
    name: "班公湖开放观景区域",
    shortName: "班公湖",
    kind: "attraction",
    lat: 33.56,
    lng: 79.18,
    elevationM: 4241,
    detail: "10 月 2 日机动景点。只使用中国一侧正规开放观景点，不驶向未开放边境湖段，下午必须返回狮泉河。",
  },
];

export const aliPermitBypassRoutePoints = [
  ...aliLhasaReturnRoutePoints
    .filter((point) => !everestDetourPointIds.has(point.id))
    .map((point) => {
      if (point.id === "ebc") {
        return {
          ...point,
          detail: "地图重点峰体，本版因日喀则边防证停发不进入定日和珠峰景区。只用来辨认方位，严禁把此点当作驾车终点或离开 G219 寻路。",
        };
      }
      if (point.id === "shigatse") {
        return {
          ...point,
          detail: "南线枢纽。本版只把日喀则市区作为过夜和补给，不去定日、珠峰或吉隆；次日经拉孜走 G219 去萨嘎。",
        };
      }
      if (point.id === "saga") {
        return {
          ...point,
          detail: "G219 西行关键住宿点。本版 9 月 28 日直接到这里，不再经定日；萨嘎、仲巴检查站出发前再核阿里电子证口径。",
        };
      }
      if (point.id === "shiquanhe") {
        return {
          ...point,
          detail: "阿里地区综合补给中心。札达满房后本版 10 月 1–2 日在此连住；1 日穿土林后到店，2 日可机动班公湖，再进 G317。",
        };
      }
      return { ...point };
    }),
  ...pangongPoints,
];

const clonePlanning = (day: number): AliRouteDailyPlanning => {
  const plan = aliLhasaReturnDailyPlanning.find((item) => item.day === day);
  if (!plan) throw new Error(`missing Lhasa-return planning for day ${day}`);
  return {
    ...plan,
    reservations: plan.reservations.map((item) => ({ ...item })),
    stay: {
      ...plan.stay,
      hotels: plan.stay.hotels.map((hotel) => ({ ...hotel })),
    },
  };
};

const replaceDay = (date: string, replacement: Partial<AliRouteDay>): AliRouteDay => {
  const day = aliLhasaReturnRouteDays.find((item) => item.date === date);
  if (!day) throw new Error(`missing Lhasa-return day ${date}`);
  return {
    ...day,
    ...replacement,
    pointIds: replacement.pointIds ? [...replacement.pointIds] : [...day.pointIds],
    highlights: replacement.highlights ? [...replacement.highlights] : [...day.highlights],
  };
};

export const aliPermitBypassRouteDays: AliRouteDay[] = [
  replaceDay("09.26", {
    supply: "在拉萨一次性补齐阿里地区电子边境通行证、氧气、现金、离线地图、水粮和保暖装备；不要申请日喀则前往地。车辆拍照并核对轮胎、备胎和救援范围。",
    risk: "落地当天最需要防范高反、饮酒、久热水澡和过度兴奋。日喀则电子边境通行证仍停发时，不去定日和珠峰，也不把吉隆灾害区当作绕行。",
    decision: "静息状态仍明显不适、血氧持续异常、车辆关键装备不齐，或阿里电子证未获批，第二天不离开拉萨。",
  }),
  replaceDay("09.27", {
    overnight: "日喀则市区。只作为过夜和补给，不把次日改成定日或珠峰。",
    decision: "准时则保留卡若拉短停和江孜白居寺。若羊湖段出现降雪、结冰或封控，跳过卡若拉/江孜支线，按交警建议改走可行路线，仍以日喀则市区为当晚目标。",
  }),
  {
    day: 3,
    date: "09.28",
    title: "日喀则 → 拉孜 → 萨嘎",
    distance: "约 450–500 km",
    driving: "约 8–10 小时，扎什伦布寺只做早场",
    roads: "G318 / G219",
    pointIds: ["shigatse", "tashilhunpo", "lhatse", "saga"],
    highlights: ["扎什伦布寺", "拉孜补给", "G219 西行", "萨嘎住宿"],
    supply: "日喀则早餐后早出发，拉孜强制补油和热食；不去定日白坝，也不从拉孜南下珠峰路口。",
    overnight: "萨嘎县城。",
    risk: "这是本版最长的南线推进日之一。萨嘎、仲巴部分乡镇在边境管理区名单里，现场可能查阿里电子证；没有日喀则证时不要试探定日检查站。",
    decision: "扎什伦布寺排队超过计划就缩短参观。拉孜之后若前方检查站不放行阿里证，不南下定日，折返拉萨后改 G317 北进狮泉河。",
  },
  replaceDay("10.01", {
    day: 4,
    date: "09.29",
    highlights: ["国王峰远观", "仲巴沙丘河谷", "玛旁雍措", "拉昂措短停", "冈仁波齐日落"],
    decision: "若到帕羊已明显晚于计划，缩短玛旁雍措和拉昂措停留但保留塔钦住宿；不得夜间绕湖。萨嘎检查站若临时加查日喀则证，停止西进并启动北线预案。",
  }),
  {
    day: 5,
    date: "09.30",
    title: "塔钦周边 · 冈仁波齐远观与玛旁雍措",
    distance: "约 80–140 km",
    driving: "约 3–5 小时，不过夜转场",
    roads: "G219 / 神山圣湖开放道路",
    pointIds: ["darchen", "kailash", "manasarovar", "darchen"],
    highlights: ["冈仁波齐晨光", "塔钦远观", "玛旁雍措", "塔钦连住"],
    supply: "塔钦连住，不退房；只在正规观景点和开放道路短停，午餐回镇上解决。",
    overnight: "塔钦连住。",
    risk: "本日是珠峰取消后还回来的缓冲日，不安排转山，也不把佩枯措、科加寺或其他边境支线设为必到。",
    decision: "风雪、高反或观光车停运时，改为塔钦休息和车辆检查；不把这一天重新加回珠峰或吉隆。",
  },
  {
    day: 6,
    date: "10.01",
    title: "塔钦 → 门士 → 札达土林穿行 → 狮泉河",
    distance: "约 500–540 km",
    driving: "约 10–12 小时；札达县城满房，不住宿",
    roads: "G219 / G565 / 札达方向连接道路",
    pointIds: ["darchen", "kailash", "menshi", "zanda-earth", "zanda", "shiquanhe"],
    highlights: ["冈仁波齐南麓", "札达土林穿行", "出盆地", "狮泉河连住"],
    supply: "塔钦满油并带午餐，门士只做状态检查；土林短停后在札达县城只补油补餐，不住宿；狮泉河到店后补给并与次日连住。",
    overnight: "狮泉河镇，与 10 月 2 日连住。",
    risk: "札达支线弯多、落差大，峡谷阴影区可能结冰。没有县城确认房，不能在盆地过夜，也不得摸黑走土林支线。",
    decision: "06:30 前离开塔钦。13:30 仍未进入札达盆地则取消土林停留，改巴尔直走 G219。古格和托林一律取消。日落前必须出谷，当晚唯一目标是狮泉河。",
  },
  {
    day: 7,
    date: "10.02",
    title: "狮泉河 ⇄ 日土 / 班公湖｜可整日取消",
    distance: "约 280–320 km 往返",
    driving: "约 6–8 小时；任一项不佳则留在狮泉河",
    roads: "G219 狮泉河至日土开放道路",
    pointIds: ["shiquanhe", "rutog", "pangong", "shiquanhe"],
    highlights: ["班公湖", "日土短停", "狮泉河连住", "北线前总检"],
    supply: "狮泉河满油出发；日土补热食；下午返回后完成全车检查、清洁空滤并补齐北线食品。",
    overnight: "狮泉河镇连住。",
    risk: "班公湖在边境管理区，检查站可能核对电子证前往地。湖区风大，只停正规开放点，不驶向未开放边境湖段。",
    decision: "07:00 先看天气、身体、车况和证件前往地。任一项不佳，或 10 月 1 日到店过晚，整日取消班公湖，留在狮泉河休息。不去札达往返古格。",
  },
  replaceDay("10.03", { day: 8 }),
  replaceDay("10.04", { day: 9 }),
  replaceDay("10.05", { day: 10 }),
  replaceDay("10.06", { day: 11 }),
  replaceDay("10.07", { day: 12 }),
];

const niaPauseUrl = "https://www.nia.gov.cn/n897453/c1797217/content.html";
const standardRoomBudget = "¥200–400 / 标间";
const nationalDayHotelAdvice =
  "国庆房价与库存波动很大：现在先锁可免费取消房，入住前 7 天、72 小时各复核一次；若超出预算，按同城候选顺序切换，不订无独卫、无热水或无法确认停车的房间。";

const day1 = clonePlanning(1);
day1.reservations[0] = {
  ...day1.reservations[0]!,
  subject: "阿里地区电子边境通行证",
  note: "2026 年 4 月 15 日起启用电子边境通行证。本版只申请阿里地区，不要勾选日喀则市。阿里边境县包括普兰、札达、噶尔、日土等；班公湖在日土县。已获批后打开电子证核对前往地：写阿里地区整区或已列日土，一般不必重办；若只列了部分县且没有日土，去班公湖前按移民局说明重新申请，新证签发后旧证失效。不确定打 12367。",
};
day1.reservations.unshift({
  subject: "日喀则电子边境通行证停发",
  status: "必须提前",
  leadTime: "出发前每天核对国家移民管理局是否发布恢复签发公告",
  channel: "国家移民管理局官网 / “移民局12367”App 或小程序",
  documents: "已签发电子证截图、身份证；本版按未持有日喀则前往地处理",
  note: "2026 年 8 月 28 日零时起暂停签发前往日喀则市电子边境管理区通行证，已持证人员也暂勿前往上述地区，恢复时间另行发布。本版因此取消定日、珠峰和吉隆，改走日喀则市区经拉孜到萨嘎，再进阿里。",
  sourceLabel: "国家移民管理局 · 2026 年第 5 号公告",
  sourceUrl: niaPauseUrl,
});

const day2 = clonePlanning(2);
day2.stay.hotels[0] = {
  ...day2.stay.hotels[0]!,
  strengths: "供氧、免费停车和充电桩，出城前往拉孜、萨嘎顺路；优先确认双床供氧是否含在房价。",
};

const day3 = clonePlanning(5);
day3.day = 3;
day3.reservations = [
  {
    subject: "扎什伦布寺",
    status: "现场办理",
    leadTime: "无需占用前一晚抢票；建议开门后尽早到场并预留 1–1.5 小时",
    channel: "景区正规售票窗口；如临时上线实名预约，以当日官方公告为准",
    documents: "二代身份证；优惠证件原件",
    note: "已核对的官方资料未写明散客强制提前预约。当天还要赶到萨嘎，只做早场；排队超过计划就缩短参观，不南下定日补珠峰。",
    sourceLabel: "西藏文旅厅 · 扎什伦布寺景区介绍",
    sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202507/t20250727_491985.html",
  },
  {
    subject: "萨嘎方向检查站与阿里电子证",
    status: "出发前复核",
    leadTime: "日喀则出发前再核萨嘎、仲巴检查站对阿里证的放行口径",
    channel: "移民局 12367、当地边检/12345，以及已走通车辆的当日信息",
    documents: "身份证、阿里地区电子边境通行证及打印件、驾驶证和车辆证件",
    note: "8 月底现场有车主反馈：G349/G219 经萨嘎进阿里，只持阿里证可通过；定日检查站没有日喀则证过不去。萨嘎、仲巴部分乡镇在边境名单里，口径可能变化。放行失败时折返拉萨，改 G317 北进，不去吉隆。",
    sourceLabel: "国家移民管理局 · 2026 年第 5 号公告",
    sourceUrl: niaPauseUrl,
  },
];

const day4 = clonePlanning(6);
day4.day = 4;
day4.reservations = day4.reservations.map((item) => ({
  ...item,
  documents: item.documents.replace("日喀则", "阿里"),
  note: item.note.replace("珠峰", "定日珠峰已取消，"),
}));

const day5 = clonePlanning(6);
day5.day = 5;
day5.reservations = [
  {
    subject: "冈仁波齐塔钦远观与玛旁雍措",
    status: "建议提前",
    leadTime: "沿用前一日神山圣湖订单；当天只复核开放区域、观光车和天气",
    channel: "携程、同程等正规渠道或景区热线 400-666-6712；以 2026 国庆公告为准",
    documents: "二代身份证、阿里地区电子边境通行证；优惠证件原件",
    note: "本日连住塔钦，不进行转山，也不去佩枯措拉普村或日喀则边境支线。这是取消珠峰后还回来的缓冲，用来恢复和看神山圣湖。",
    sourceLabel: "西藏文旅厅 · 神山圣湖 2025 运营信息",
    sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202505/t20250509_477364.html",
  },
];
day5.stay = {
  ...day5.stay,
  city: "塔钦（巴嘎镇）连住",
  bookingAdvice: `${nationalDayHotelAdvice} 本晚与 9 月 29 日同店连住，减少搬运行李；订前确认连住保留和次日塔钦出城道路。`,
};

const day6 = clonePlanning(7);
day6.day = 6;
day6.reservations = [
  {
    subject: "札达土林穿行（不住宿）",
    status: "出发前复核",
    leadTime: "提前 1–3 天查看“智游阿里”和札达道路公告，入谷前再确认",
    channel: "“智游阿里”微信小程序或景区正规现场窗口",
    documents: "二代身份证、阿里地区电子边境通行证；车辆证件随车",
    note: "札达县城 10 月 1 日满房，本版改为穿行后住狮泉河。不安排古格或托林。未进盆地或时间不够，在巴尔直走 G219。不驶入未开放土林沟谷，日落前必须出盆地。",
    sourceLabel: "西藏文旅厅 · 阿里智慧旅游平台",
    sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/xydt/202507/t20250718_490235.html",
  },
];
day6.stay = {
  ...day6.stay,
  city: "狮泉河镇",
  bookingAdvice: `${nationalDayHotelAdvice} 札达满房后本晚改住狮泉河，与 10 月 2 日同店连住；订前确认晚到保留房、停车和供氧。`,
};

const day7 = clonePlanning(7);
day7.day = 7;
day7.reservations = [
  {
    subject: "班公湖（可整日取消）",
    status: "出发前复核",
    leadTime: "10 月 1 日到店后核对天气、开放范围和电子证前往地",
    channel: "日土县现场管理、12345、景区正规开放点；未查到 2026 国庆统一强制预约",
    documents: "二代身份证、阿里地区电子边境通行证及打印件；前往地含日土或阿里整区",
    note: "狮泉河往返约 300 公里。只使用中国一侧正规观景点，不驶向未开放边境湖段。电子证若未覆盖日土，当天取消，不要赌检查站。高反、风雪或前一日过晚到店，整日留在狮泉河修车睡觉。",
    sourceLabel: "国家移民管理局 · 电子边境通行证办理",
    sourceUrl: "https://s.nia.gov.cn/mps/bszy/dzbjtxz/blzy/202604/t20260414_1001.html",
  },
];
day7.stay = {
  ...day7.stay,
  city: "狮泉河镇连住",
  bookingAdvice: `${nationalDayHotelAdvice} 本晚与 10 月 1 日同店连住；到店后复核洞措住宿和 10 月 5 日拉萨保留房。`,
};

const laterDays = [8, 9, 10, 11, 12].map((day) => {
  const plan = clonePlanning(day);
  plan.day = day;
  return plan;
});

export const aliPermitBypassPlanningReviewedAt = "2026-09-14";

export const aliPermitBypassDailyPlanning: AliRouteDailyPlanning[] = [
  day1,
  day2,
  day3,
  day4,
  day5,
  day6,
  day7,
  ...laterDays,
];
