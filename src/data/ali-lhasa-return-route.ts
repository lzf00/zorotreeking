import {
  aliRouteDays,
  aliRoutePoints,
  type AliRouteDay,
  type AliRouteDailyPlanning,
  type AliRoutePoint,
} from "./ali-route";

const shanghaiReturnPoint: AliRoutePoint = {
  id: "shanghai",
  name: "上海虹桥或浦东机场",
  shortName: "上海",
  kind: "city",
  lat: 31.1943,
  lng: 121.327,
  elevationM: 4,
  detail: "团队 10 月 7 日返沪终点；只把已经出票且明确显示日期和到达机场的订单视为有效返程。",
  services: "机场、高铁、轨道交通、酒店、医疗",
};

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
        detail: "取还车城市：9 月 26 日完成适应和补给，10 月 5 日晚回到这里住宿，10 月 6 日完成还车缓冲。",
      };
    }
    if (point.id === "shiquanhe") {
      return {
        ...point,
        detail: "阿里地区综合补给中心。本版 10 月 2 日到这里过夜，只做车辆、油料和北线物资复核，第二天进入 G317。",
      };
    }
    if (point.id === "gyantse") {
      return {
        ...point,
        detail: "南线历史城镇。09.27 准时则进白居寺，不准时只补给后直奔日喀则至格酒店。",
      };
    }
    if (point.id === "dongco") {
      return {
        ...point,
        kind: "supply" as const,
        detail: "G317 途经乡镇。本版 10 月 3 日已锁改则过夜，洞措只做路况观察，不再当作住宿开关。",
        services: "有限餐饮与基础补给，以当日电话确认结果为准",
      };
    }
    if (point.id === "nyima") {
      return {
        ...point,
        kind: "supply" as const,
        detail: "G317 途经补给。本版不在尼玛过夜，只补油热食后继续东进班戈。",
      };
    }
    if (point.id === "baingoin") {
      return {
        ...point,
        kind: "overnight" as const,
        detail: "北线 10 月 4 日过夜点。本版当晚住纳木错富氧酒店（班戈店），次日再去纳木措后回拉萨。",
      };
    }
    return { ...point };
  }),
  shanghaiReturnPoint,
];

const copiedDrivingDays = aliRouteDays.slice(2, 11).map((day) => ({
  ...day,
  day: day.day - 1,
  pointIds: [...day.pointIds],
  highlights: [...day.highlights],
}));

const replaceCopiedDrivingDay = (date: string, replacement: Partial<AliRouteDay>) => {
  const index = copiedDrivingDays.findIndex((day) => day.date === date);
  if (index < 0) return;
  const day = copiedDrivingDays[index]!;
  copiedDrivingDays[index] = {
    ...day,
    ...replacement,
    pointIds: replacement.pointIds ? [...replacement.pointIds] : day.pointIds,
    highlights: replacement.highlights ? [...replacement.highlights] : day.highlights,
  };
};

replaceCopiedDrivingDay("09.27", {
  overnight: "至格酒店（日喀则藏隆广场店），山东中路 16 号；已锁 09.27 一晚。",
  decision:
    "准时则保留卡若拉短停和江孜白居寺。12:30 仍未离开浪卡子，跳过卡若拉和白居寺，仍以日喀则至格酒店为当晚目标。羊湖段降雪、结冰或封控时，按交警建议改走可行路线。",
});

replaceCopiedDrivingDay("09.28", {
  overnight: "我与乔木酒店；已锁 09.28 三间。执行珠峰过夜则当晚住这里。",
  decision:
    "扎什伦布只做早场。排队超过计划就缩短参观，不压缩定日到达缓冲。若珠峰次日不开放，取消珠峰折返，直接把萨嘎作为下一安全目的地。",
});

replaceCopiedDrivingDay("09.29", {
  title: "定日 → 加乌拉 → 珠峰景区开放区域 → 巴松顺康富氧",
  distance: "约 110–150 km",
  driving: "约 4–6 小时，上午进景区，傍晚回到巴松看日落",
  roads: "G318 / 珠峰景区道路",
  pointIds: ["tingri", "gawula", "rongbuk", "ebc"],
  highlights: ["加乌拉群峰", "绒布寺", "珠峰日落", "巴松星空"],
  supply: "定日早餐后满油出发，午餐和热水随车带入；巴松顺康富氧可晚餐和热水，不依赖景区内简陋补给。",
  overnight: "顺康富氧酒店，定日扎西宗乡巴松村；已锁 09.29 一晚。满房或到店异常时改住同村吉山吉舍。",
  risk: "顺康在巴松村、距大本营约 24 公里，不要看完景区日落再摸黑赶回；星空和珠峰夜景改在酒店附近看。",
  decision: "门票、观光车和顺康保留房都要先确认；下午离开景区开放区域，日落前回到巴松。",
});

replaceCopiedDrivingDay("09.30", {
  title: "巴松顺康 → 定日 → 萨嘎",
  distance: "约 330–380 km",
  driving: "约 8–10 小时，早上离开巴松",
  roads: "珠峰景区道路 / G318 / G219",
  pointIds: ["tingri", "saga"],
  highlights: ["巴松晨光", "加乌拉回望", "G219 西行", "萨嘎补给"],
  supply: "酒店早餐后出发，定日/白坝片区补油和热食，再沿 G219 去萨嘎；抵达后补满燃油。",
  overnight: "萨嘎强吉福酒店，格桑街 172 号；已锁 09.30 一晚。",
  risk: "前一晚高海拔睡眠质量可能差，本日不再安排新的深度景点，也不再折返进珠峰景区；若早晨风雪延误，优先保证白天抵达萨嘎。",
  decision: "10:00 前离开巴松；若中午仍未回到定日主路，取消沿途停留，只把萨嘎作为安全住宿目标。",
});

replaceCopiedDrivingDay("10.01", {
  title: "萨嘎 → 仲巴 → 帕羊 → 玛旁雍措 → 塔钦",
  distance: "约 500–520 km",
  driving: "约 10–12 小时",
  roads: "G219",
  pointIds: ["saga", "king-peak", "zhongba", "paryang", "manasarovar", "darchen"],
  highlights: ["国王峰远观", "仲巴沙丘河谷", "玛旁雍措", "拉昂措短停", "冈仁波齐日落"],
  supply: "萨嘎满油早出发，仲巴必须补油，帕羊二次热食；塔钦到店后补齐次日札达段水粮。",
  overnight: "塔钦云端盛景酒店；已锁 10.01 一晚。去哪儿塔尔庆 09.29–10.01 仍要取消。",
  risk: "这是前段保留神山圣湖时间后的长途日；只在正规观景点短停，不驶离 G219 追湖岸机位。",
  decision:
    "准时可在玛旁雍措后再停拉昂措。若到帕羊已明显晚于计划，取消拉昂措并缩短玛旁雍措停留，仍保留塔钦住宿；不得夜间绕湖。",
});

replaceCopiedDrivingDay("10.02", {
  title: "塔钦 → 门士 → 札达土林/古格择一 → 狮泉河",
  distance: "约 500–540 km",
  driving: "约 10–12 小时；札达可做土林穿行加一处短参观，不住宿",
  roads: "G219 / G565 / 札达方向连接道路",
  pointIds: ["darchen", "kailash", "menshi", "zanda-earth", "zanda", "guge", "tholing", "shiquanhe"],
  highlights: ["冈仁波齐南麓", "札达土林穿行", "古格或托林择一", "狮泉河补给"],
  supply: "塔钦满油和早餐后出发，门士只做状态检查；札达县城补餐和加油，不住宿；狮泉河完成车辆、油料和北线物资复核。",
  overnight: "云朵酒店，狮泉路 1 号；已锁 10.02 一晚。",
  risk: "珠峰景区过夜占掉一天，札达仍排不进单独住宿；古格和托林寺只能择一。狮泉河当晚要赶改则，这版加不进班公湖。",
  decision:
    "06:30 前从塔钦出发。土林穿行优先；13:30 仍未进入札达盆地则取消古格/托林。日落前离开札达盆地，夜里不在峡谷赶车，也不从狮泉河再折返班公湖。",
});

replaceCopiedDrivingDay("10.03", {
  title: "狮泉河 → 革吉 → 改则",
  distance: "约 380–450 km",
  driving: "约 7–9 小时，北线赶到改则过夜",
  roads: "G317",
  pointIds: ["shiquanhe", "geji", "xiongba", "gerze"],
  highlights: ["G317 长直路段", "革吉短停", "改则补给住宿"],
  supply: "狮泉河满油；革吉见站即补，改则到店后补满油和热食。",
  overnight: "改则康盛富氧酒店；已锁 10.03 一晚。不再继续赶洞措。",
  risk: "改则过夜比洞措稳。次日只赶到班戈，把纳木措留给 10 月 5 日上午，避免再叠成 600 公里长途日。",
  decision: "主车每 90–120 分钟换人休息；天黑前必须进改则，不把洞措当天硬赶完。",
});

replaceCopiedDrivingDay("10.04", {
  title: "改则 → 尼玛 → 色林措 → 班戈",
  distance: "约 450–550 km",
  driving: "约 8–10 小时，只保留色林措一个核心停留",
  roads: "G317 及开放观景连接道路",
  pointIds: ["gerze", "dongco", "nyima", "selin", "baingoin"],
  highlights: ["尼玛补给", "色林措远观", "藏北湖群", "班戈过夜"],
  supply: "改则早餐后早出发，洞措只做路况观察，尼玛补油和热食，色林措只在正规开放点短停，当晚住班戈。",
  overnight: "纳木错富氧酒店（班戈店）；已锁 10.04 一晚。",
  risk: "仍是北线较长赶路日，但比直接赶到纳木措少 150–200 公里。湖区风大、保护区管制必须服从现场要求。",
  decision: "12:30 仍未到尼玛或天气变差，取消色林措停留，直接沿主线赶班戈；不得继续东进纳木措过夜。",
});

replaceCopiedDrivingDay("10.05", {
  title: "班戈 → 纳木措 → 当雄 → 拉萨",
  distance: "约 320–400 km",
  driving: "约 6–8 小时，上午看纳木措，下午到拉萨",
  roads: "G317 / 纳木措开放道路 / G109",
  pointIds: ["baingoin", "namtso", "damxung", "lhasa"],
  highlights: ["纳木措", "念青唐古拉山", "当雄补给", "10 月 5 日回到拉萨"],
  supply: "班戈早餐后早出发；纳木措只按开放道路停留，当雄补油后回拉萨，抵达后只做停车、入住和必要车辆检查。",
  overnight: "拉萨市区。09.26 已住过柏丽艾尚，10.05–06 连住优先同一家，截图尚未出这两晚订单。",
  risk: "纳木措现在有上午窗口，但仍不去圣象天门、扎西半岛深度游或湖边支线；国庆返程车流可能让抵达时间后移。",
  decision: "07:30 前离开班戈。若纳木措关闭、排队过长或 14:00 仍未离开湖区，直接经当雄回拉萨，守住当晚住宿。",
});

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
    overnight: "柏丽艾尚酒店（军区总医院慈松塘西路店），慈松塘西路北侧附 2 号；已锁 09.26 一晚。",
    risk: "落地当天最需要防范高反、饮酒、久热水澡和过度兴奋；不要把城市游览排进取车适应日。",
    decision: "静息状态仍明显不适、血氧持续异常或车辆关键装备不齐，第二天不离开拉萨，宁可缩短阿里行程。",
  },
  ...copiedDrivingDays,
  {
    day: 11,
    date: "10.06",
    title: "拉萨休整 → 加油洗车 → 同城还车",
    distance: "市内约 0–65 km",
    driving: "弹性安排；如提前飞离则机场段约 1–1.5 小时",
    roads: "拉萨城市道路 / 机场高速（可选）",
    pointIds: ["lhasa", "gonggar-airport", "lhasa"],
    highlights: ["补觉恢复", "车辆整理", "同城还车", "返沪缓冲"],
    supply: "上午优先补觉和整理行李，再完成加油、洗车、还车验收和电子凭证复核；只保留机场或医院等必要市内移动。",
    overnight: "拉萨市区，优先与 10 月 5 日同店连住；若 10 月 6 日已有确定晚班，可提前离藏。",
    risk: "10 月 5 日若次日凌晨才到店，10 月 6 日不再安排布达拉宫或任何出城景点，避免把休整日再次变成长途日。",
    decision: "只有在人员状态稳定、车辆还车完成且航班已出票时，才考虑 10 月 6 日晚提前返程；否则守住拉萨住宿和 10 月 7 日飞行。",
  },
  {
    day: 12,
    date: "10.07",
    title: "拉萨 → 贡嘎机场 → 上海｜当日必须抵达",
    distance: "机场段约 65 km + 航班转场",
    driving: "约 1–1.5 小时（不含航班）",
    roads: "机场高速 / 拉萨至上海航班",
    pointIds: ["lhasa", "gonggar-airport", "shanghai"],
    highlights: ["还车凭证复核", "贡嘎机场", "拉萨直飞上海", "返沪硬截止"],
    supply: "优先在 10 月 6 日完成加油、洗车和还车；10 月 7 日只保留酒店至机场的人员与行李转场。",
    overnight: "当晚抵达上海。",
    risk: "国庆返程和高原天气可能造成航变，未出票联程、候补和紧张中转都不能视为有效返沪方案。",
    decision: "优先购买拉萨直飞上海且可退改的航班；若 10 月 6 日车况和身体状态都稳定且有确定晚班，可提前一晚离藏增加缓冲。",
  },
];

const standardRoomBudget = "¥200–400 / 标间";
const nationalDayHotelAdvice =
  "国庆房价与库存波动很大：现在先锁可免费取消房，入住前 7 天、72 小时各复核一次；若超出预算，按同城候选顺序切换，不订无独卫、无热水或无法确认停车的房间。";

export const aliLhasaReturnPlanningReviewedAt = "2026-09-18";

export const aliLhasaReturnDailyPlanning: AliRouteDailyPlanning[] = [
  {
    day: 1,
    reservations: [
      {
        subject: "电子边境通行证",
        status: "必须提前",
        leadTime: "建议出发前 7–15 天申请，获批后下载并打印一份备份",
        channel: "国家移民管理局政务服务平台，或“移民局12367”App / 微信、支付宝小程序",
        documents: "二代身份证；16 岁以下同行儿童需到现场作为随行人添加",
        note: "2026 年 4 月 15 日起启用电子边境通行证，证件有效期最长 3 个月且免费办理。本行程按可办日喀则证、可进入定日和珠峰执行；前往地需含日喀则市定日县，并继续持有阿里证（普兰、札达、噶尔、日土等）。获批后下载并打印纸质备份，出发前再核 12367 与检查站口径。",
        sourceLabel: "国家移民管理局 · 电子边境通行证问答",
        sourceUrl: "https://s.nia.gov.cn/mps/bszy/dzbjtxz/blzy/202604/t20260414_1001.html",
      },
      {
        subject: "拉萨租车与国庆还车",
        status: "必须提前",
        leadTime: "建议提前 30–60 天锁定四驱或高离地间车型",
        channel: "租车订单平台 + 门店书面确认",
        documents: "身份证、驾驶证、信用卡或平台要求的押金材料",
        note: "订单备注 G219/G317 长途使用、同城还车、救援范围、防滑链与备胎；取车时拍摄全车、轮胎、油量和里程，并把 10 月 5 日回拉萨、10 月 6 日还车缓冲写入订单。",
        sourceLabel: "携程租车 · 实时车型与门店订单",
        sourceUrl: "https://car.ctrip.com/",
      },
    ],
    stay: {
      city: "拉萨市区",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 09.26 已锁柏丽艾尚一晚。`,
      hotels: [
        {
          name: "柏丽艾尚酒店（军区总医院慈松塘西路店）",
          strengths: "已锁 09.26 一晚。慈松塘西路北侧附 2 号整栋楼，靠近军区总医院，适合落地适应。",
          bookingUrl: "https://www.bthhotels.com/hotel/PL0009",
        },
        {
          name: "拉萨新气象酒店（八廓街店）",
          strengths: "近老城、停车评价较多；仅作 09.26 无法确认停车时的备选。",
          bookingUrl: "https://hotels.ctrip.com/hotel/113895184.html",
        },
      ],
    },
  },
  {
    day: 2,
    reservations: [
      {
        subject: "羊卓雍措",
        status: "建议提前",
        leadTime: "提前 1–3 天实名购票；最晚前一晚完成",
        channel: "“羊卓雍错”微信小程序/公众号，或携程、抖音、美团；也可游客中心现场购票",
        documents: "二代身份证；享受优惠者同时携带对应证件原件",
        note: "2026 年官方规则支持线上或游客中心实名购票。按 1 号至 3 号开放观景平台行驶，不把非铺装湖岸当作自驾路线。",
        sourceLabel: "西藏文旅厅 · 羊卓雍措 2026 购票方式",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202603/t20260316_529530.html",
      },
      {
        subject: "卡若拉冰川",
        status: "出发前复核",
        leadTime: "出发前 24 小时确认开放、停车和是否恢复收费",
        channel: "浪卡子县文旅/景区现场公告；未查到 2026 年统一强制预约渠道",
        documents: "身份证；车辆与驾驶证件随车",
        note: "官方 2026 公告确认浪卡子辖区景区在运营活动范围内，但未发布统一预约规则。只在正规停车点短停，现场关闭就直接前往江孜。",
        sourceLabel: "西藏文旅厅 · 浪卡子县 2026 景区公告",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202607/t20260708_549150.html",
      },
    ],
    stay: {
      city: "日喀则市区",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 09.27 已锁至格酒店一晚。`,
      hotels: [
        {
          name: "至格酒店（日喀则藏隆广场店）",
          strengths: "已锁 09.27 一晚。山东中路 16 号，藏隆广场，出城前往定日/珠峰顺路。",
          bookingUrl: "https://hotels.ctrip.com/hotels/133284776.html",
        },
        {
          name: "如家精选富氧酒店（日喀则吉林南路店）",
          strengths: "供氧、免费停车和充电桩；仅作至格无法入住时的备选。",
          bookingUrl: "https://hotels.ctrip.com/hotels/129144954.html",
        },
      ],
    },
  },
  {
    day: 3,
    reservations: [
      {
        subject: "扎什伦布寺",
        status: "现场办理",
        leadTime: "无需占用前一晚抢票；建议开门后尽早到场并预留 1.5–2 小时",
        channel: "景区正规售票窗口；如临时上线实名预约，以当日官方公告为准",
        documents: "二代身份证；优惠证件原件",
        note: "已核对的官方资料未写明散客强制提前预约。当天车程较长，只做早场参观；若排队超过计划，缩短参观而不是压缩定日到达缓冲。",
        sourceLabel: "西藏文旅厅 · 扎什伦布寺景区介绍",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202507/t20250727_491985.html",
      },
      {
        subject: "珠峰景区次日门票、观光车与住宿",
        status: "建议提前",
        leadTime: "提前 1–3 天锁定门票、观光车；抵达定日后再次核验班次和巴松顺康保留房",
        channel: "正规在线旅游平台、景区售票渠道和顺康富氧订单；不向个人转账买票或订房",
        documents: "二代身份证、电子边境通行证；优惠人群带证件原件；顺康入住确认",
        note: "本版按上午进珠峰景区、傍晚回到巴松顺康富氧看日落和星空处理。购票后保存订单二维码，前一晚核对发车时间、风雪、开放区域和顺康保留房。",
        sourceLabel: "西藏文旅厅 · 珠峰景区 2026 开放与实名规则",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202603/t20260316_529530.html",
      },
    ],
    stay: {
      city: "定日白坝片区",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 09.28 已锁我与乔木三间。智行另有 09.28 萨嘎强吉福，与定日撞期，执行珠峰版则取消那一晚萨嘎。`,
      hotels: [
        {
          name: "我与乔木酒店",
          strengths: "已锁 09.28 三间（两间标准双床 + 一间供氧家庭套房）。执行珠峰过夜则当晚住这里，次日转巴松顺康。",
          bookingUrl: "https://hotels.ctrip.com/hotel/tingri21137",
        },
        {
          name: "汇峰酒店（珠峰小镇店）",
          strengths: "珠峰小镇入口附近、停车和充电方便；仅作我与乔木无法入住时的定日备选。",
          bookingUrl: "https://hotels.ctrip.com/hotels/131626747.html",
        },
      ],
    },
  },
  {
    day: 4,
    reservations: [
      {
        subject: "珠峰景区、绒布寺与巴松顺康",
        status: "必须提前",
        leadTime: "前一晚完成门票、观光车和顺康保留房复核；建议提前 1–3 天购票",
        channel: "景区正规票务/在线旅游平台 + 定日游客换乘点 + 顺康富氧酒店",
        documents: "二代身份证、电子边境通行证、门票与观光车订单、顺康入住确认",
        note: "社会车辆按现场组织停放并换乘观光车；上午进景区，下午离开开放区域，日落前回到巴松顺康。日落和星空改在酒店附近看，不从大本营摸黑赶回。",
        sourceLabel: "西藏文旅厅 · 珠峰景区 2026 实名与观光车",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202603/t20260316_529530.html",
      },
    ],
    stay: {
      city: "定日巴松村",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 09.29 已锁顺康富氧一晚（巴松村）。去哪儿塔尔庆 09.29–10.01 与本晚撞期，执行珠峰过夜则取消；10.01 已改住塔钦云端盛景。`,
      hotels: [
        {
          name: "顺康富氧酒店（定日扎西宗乡巴松村）",
          strengths: "已锁 09.29 供氧三人间。巴松村珠峰路，距大本营约 24 公里，方便看日落星空后就近住下。",
          bookingUrl: "https://hotels.ctrip.com/hotels/78367749.html",
        },
        {
          name: "吉山吉舍（珠峰大本营店）",
          strengths: "同村约 9 间景观房备选；顺康到店异常时再转。",
          bookingUrl: "https://hotels.ctrip.com/hotels/80810143.html",
        },
      ],
    },
  },
  {
    day: 5,
    reservations: [
      {
        subject: "珠峰景区清晨离场与 G219 西行",
        status: "出发前复核",
        leadTime: "9 月 29 日入住顺康时确认次日退房、道路和萨嘎强吉福保留房",
        channel: "顺康前台、定日游客换乘点、当地交警和萨嘎酒店",
        documents: "身份证、电子边境通行证、门票订单、萨嘎强吉福订单",
        note: "本日从巴松顺康看珠峰晨光后西行，不再折返进景区，也不把佩枯措或其他支线设为必到点。前一晚睡眠差、头痛明显或风雪延误时，优先安全抵达萨嘎。",
        sourceLabel: "西藏文旅厅 · 珠峰景区 2026 实名与观光车",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202603/t20260316_529530.html",
      },
    ],
    stay: {
      city: "萨嘎县城",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 09.30 已锁萨嘎强吉福一晚。智行里另有一单 09.28 同店，与定日我与乔木撞期，执行珠峰版则取消 09.28 萨嘎。`,
      hotels: [
        {
          name: "萨嘎强吉福酒店",
          strengths: "已锁 09.30 一晚。格桑街 172 号，珠峰高海拔夜宿后的县城落脚。",
          bookingUrl: "https://m.ctrip.com/html5/hotel/hoteldetail/109179736.html",
        },
        {
          name: "云水际·未来酒店（萨嘎店）",
          strengths: "独立停车场、供氧与自驾评价较好；仅作强吉福无法入住时的备选。",
          bookingUrl: "https://hotels.ctrip.com/hotels/124069440.html",
        },
      ],
    },
  },
  {
    day: 6,
    reservations: [
      {
        subject: "神山圣湖景区（冈仁波齐 / 玛旁雍措）",
        status: "建议提前",
        leadTime: "建议提前 3–7 天购票，抵达帕羊前再确认观光车与天气",
        channel: "携程、同程等正规渠道或景区热线 400-666-6712；以 2026 国庆公告为准",
        documents: "二代身份证、电子边境通行证；优惠证件原件",
        note: "本路线只安排圣湖正规观景和塔钦远观，不进行转山。现有官方明细来自 2025 运营季，2026 票价、观光车和开放边界必须在出发前复核。",
        sourceLabel: "西藏文旅厅 · 神山圣湖 2025 运营信息",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202505/t20250509_477364.html",
      },
    ],
    stay: {
      city: "塔钦（巴嘎镇）",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 10.01 已锁塔钦云端盛景一晚。去哪儿塔尔庆 09.29–10.01 与顺康、萨嘎撞期，取消即可，不必再改期。`,
      hotels: [
        {
          name: "塔钦云端盛景酒店",
          strengths: "已锁 10.01 一晚。OTA 名神山云端盛景酒店，巴嘎乡湘醴大饭店南 50 米，距塔钦小镇约 800 米，有停车和供氧。",
          bookingUrl: "https://hotels.ctrip.com/hotels/122756916.html",
        },
        {
          name: "天马国际富氧酒店（塔钦冈仁波齐风景区店）",
          strengths: "云端盛景到店异常时的供氧备选；订前确认停车、地暖和供氧时段。",
          bookingUrl: "https://hotels.ctrip.com/hotels/134306415.html",
        },
      ],
    },
  },
  {
    day: 7,
    reservations: [
      {
        subject: "冈仁波齐塔钦远观",
        status: "无需预约",
        leadTime: "无需新增时段；前一晚只复核天气和塔钦出城道路",
        channel: "在塔钦及 G219 正规开放区域远观，不进入转山检票线路",
        documents: "身份证、电子边境通行证；神山圣湖订单留存备查",
        note: "本日不是转山行程，也不为拍摄驶入非开放支路；如临时进入收费观景区，沿用前一日已核验的神山圣湖正规票务规则。",
        sourceLabel: "西藏文旅厅 · 神山圣湖运营信息",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202505/t20250509_477364.html",
      },
      {
        subject: "札达土林",
        status: "出发前复核",
        leadTime: "提前 1–3 天查看“智游阿里”和札达当地公告，入谷前再确认道路",
        channel: "“智游阿里”微信小程序或景区正规现场窗口",
        documents: "二代身份证、电子边境通行证；车辆证件随车",
        note: "本版把珠峰景区住宿放回行程，札达不再单独住一晚，但仍可做土林穿行加古格或托林一处。未查到 2026 国庆统一强制预约条款；按正规开放道路进入，不驶入未开放土林沟谷。",
        sourceLabel: "西藏文旅厅 · 阿里智慧旅游平台",
        sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/xydt/202507/t20250718_490235.html",
      },
      {
        subject: "古格遗址或托林寺择一",
        status: "建议提前",
        leadTime: "提前 1–3 天查看“智游阿里”和札达当地公告；当天只执行一处短参观",
        channel: "“智游阿里”微信小程序、寺院正规售票窗口或景区现场公告",
        documents: "二代身份证、电子边境通行证；保存订单二维码",
        note: "珠峰过夜和 10 月 5 日回拉萨把札达压缩成短停日，古格和托林寺只能择一。若排队、天气或道路耗时超预期，直接取消参观并前往狮泉河。",
        sourceLabel: "西藏文旅厅 · 智游阿里古格预订",
        sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/xydt/202507/t20250718_490235.html",
      },
    ],
    stay: {
      city: "狮泉河镇",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 10.02 已锁云朵酒店一晚，狮泉路 1 号。到店后复核次日改则康盛保留房。`,
      hotels: [
        {
          name: "云朵酒店（狮泉河店）",
          strengths: "已锁 10.02 一晚。狮泉路 1 号，停车场大，带洗衣与充电，适合全车检查。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/gaer21068",
        },
        {
          name: "尚客优酒店（阿里噶尔县噶尔路店）",
          strengths: "供氧、免费停车、早餐；仅作云朵无法入住时的备选。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/gaer21068/h436",
        },
      ],
    },
  },
  {
    day: 8,
    reservations: [
      {
        subject: "G317 狮泉河至改则赶路段",
        status: "无需预约",
        leadTime: "出发前 24 小时核对交通、天气、加油站和改则康盛保留房",
        channel: "无票务渠道；只走 G317 主线和已开放停车点",
        documents: "身份证、驾驶证、车辆订单或行驶证、电子边境通行证备份",
        note: "狮泉河以后全员继续走 G317，沿途不新增景点。革吉、雄巴短停，当晚住改则康盛富氧，不再赶洞措。",
        sourceLabel: "西藏文旅厅 · 阿里北线线路资料",
        sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/wlyw/wldt/202507/t20250725_491772.html",
      },
    ],
    stay: {
      city: "改则县城",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 10.03 已锁改则康盛富氧一晚，不再住洞措。`,
      hotels: [
        {
          name: "改则康盛富氧酒店",
          strengths: "已锁 10.03 一晚。移动南路改则县林业局向西约 200 米，比洞措乡镇住宿稳定。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/Gertse21289",
        },
        {
          name: "改则县城其他供氧宾馆",
          strengths: "康盛到店异常时同城电话确认，不继续赶洞措过夜。",
          bookingUrl: "https://www.amap.com/search?query=%E6%94%B9%E5%88%99%E4%BE%9B%E6%B0%A7%E9%85%92%E5%BA%97",
        },
      ],
    },
  },
  {
    day: 9,
    reservations: [
      {
        subject: "色林措正规观景区域",
        status: "出发前复核",
        leadTime: "出发前 24 小时向尼玛、申扎或班戈当地文旅/12345 核对开放与管制",
        channel: "未查到 2026 统一线上票务；以现场保护区和交通管理为准",
        documents: "身份证、驾驶证、车辆证件；如现场要求实名登记则配合办理",
        note: "色林措是 10 月 4 日唯一景观目标，当晚住班戈，把纳木措留给次日上午。只使用 G317 及正规开放观景点，不进入草场、湿地和湖滩。没有可靠预约入口时，不从非官方渠道购买所谓通行名额。",
        sourceLabel: "西藏自治区发改委 · 色林措景区规划资料",
        sourceUrl: "https://drc.xizang.gov.cn/zwgk_1941/fz/zxx/201806/P020200909428490530433.pdf",
      },
    ],
    stay: {
      city: "班戈县城",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 10.04 住班戈。已锁的纳木错富氧按班戈过夜执行，次日再去纳木措。`,
      hotels: [
        {
          name: "纳木错富氧酒店（班戈店）",
          strengths: "已锁 10.04 一晚。当晚停在班戈，拆开改则到拉萨的车程。",
          bookingUrl: "https://hotels.ctrip.com/hotel/damxung217",
        },
        {
          name: "尚客优品酒店（班戈店）",
          strengths: "纳木错富氧无法入住时的同城备选；订前确认供氧、停车和晚到保留。",
          bookingUrl: "https://hotels.ctrip.com/hotels/129496888.html",
        },
      ],
    },
  },
  {
    day: 10,
    reservations: [
      {
        subject: "纳木措开放观景区域与返拉主线",
        status: "出发前复核",
        leadTime: "10 月 4 日抵达班戈后核对次日开放、G109 通行和拉萨酒店",
        channel: "当地交警、12345、纳木措景区正规渠道、班戈酒店前台和租车门店",
        documents: "身份证、驾驶证、车辆订单或行驶证、拉萨酒店订单",
        note: "10 月 5 日从班戈出发，上午在纳木措开放道路停留，下午经当雄回拉萨。不安排圣象天门、扎西半岛深度游。10.05–06 拉萨连住尚未出订单，优先续订柏丽艾尚。",
        sourceLabel: "西藏文旅厅 · 班戈与纳木措北部旅游资料",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202403/t20240327_409224.html",
      },
    ],
    stay: {
      city: "拉萨市区",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 10.05–06 拉萨连住截图尚未出单。优先续订 09.26 住过的柏丽艾尚，并电话确认 24 小时前台。`,
      hotels: [
        {
          name: "柏丽艾尚酒店（军区总医院慈松塘西路店）",
          strengths: "09.26 已住过，熟悉停车和供氧；10.05–06 连住待锁，适合还车和次日离藏。",
          bookingUrl: "https://www.bthhotels.com/hotel/PL0009",
        },
        {
          name: "拉萨新气象酒店（八廓街店）",
          strengths: "近老城；若晚间到店，订前必须电话确认院内车位、前台值守和保留房政策。",
          bookingUrl: "https://hotels.ctrip.com/hotel/113895184.html",
        },
      ],
    },
  },
  {
    day: 11,
    reservations: [
      {
        subject: "拉萨同城还车与返沪缓冲",
        status: "必须提前",
        leadTime: "10 月 5 日晚抵拉后确认门店营业、夜间停车和 10 月 6 日还车时段",
        channel: "租车订单平台 + 门店电话或工单确认",
        documents: "身份证、驾驶证、租车订单、取车照片、加油和还车验收凭证",
        note: "本版 10 月 5 日已经过纳木措并回拉萨，10 月 6 日不再安排任何出城景点；当天只做休整、洗车、还车和返沪航班复核。",
        sourceLabel: "携程租车 · 实时车型与门店订单",
        sourceUrl: "https://car.ctrip.com/",
      },
    ],
    stay: {
      city: "拉萨市区",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 本晚优先与 10 月 5 日同店连住，减少搬运行李，并确认次日机场接驳。`,
      hotels: [
        {
          name: "柏丽艾尚酒店（军区总医院慈松塘西路店）",
          strengths: "优先与 10 月 5 日同店连住，减少搬运行李，并确认次日机场接驳。",
          bookingUrl: "https://www.bthhotels.com/hotel/PL0009",
        },
        {
          name: "拉萨新气象酒店（八廓街店）",
          strengths: "若还想短暂逛老城可选；必须确认车位和次日机场接驳。",
          bookingUrl: "https://hotels.ctrip.com/hotel/113895184.html",
        },
      ],
    },
  },
  {
    day: 12,
    reservations: [
      {
        subject: "拉萨返沪航班与租车闭环",
        status: "必须提前",
        leadTime: "建议提前 30–60 天出票；10 月 6 日完成加油、验车和还车凭证",
        channel: "航空公司官方渠道 + 租车门店订单",
        documents: "身份证、航班订单、行李额度、租车验收/还车电子凭证",
        note: "10 月 7 日必须抵沪，优先直飞且可退改；不把候补或紧张中转视为有效方案。10 月 7 日当天不再安排景点和跨城还车。",
        sourceLabel: "西藏文旅厅 · 2026 拉萨至上海航线",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202606/t20260612_545303.html",
      },
    ],
    stay: {
      city: "上海",
      budget: "无需本路线住宿",
      bookingAdvice: "当日抵达上海；若航变滞留，使用航空公司或保险安排的临时住宿，不计入阿里行程酒店预算。",
      noHotelNeeded: true,
      hotels: [],
    },
  },
];
