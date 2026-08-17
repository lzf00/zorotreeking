import {
  aliRouteDays,
  aliRoutePoints,
  type AliRouteDay,
  type AliRouteDailyPlanning,
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
        detail: "阿里地区综合补给中心，也是朋友最晚 10 月 5 日抵沪的最佳分流城市；昆莎机场位于镇区西南方向。",
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
    decision: `${day.decision} 最晚 10 月 5 日抵沪的朋友当晚留在狮泉河，10 月 3 日或 4 日从昆莎机场离开，不再随车进入改则方向。`,
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

const standardRoomBudget = "¥200–400 / 标间";
const nationalDayHotelAdvice =
  "国庆房价与库存波动很大：现在先锁可免费取消房，入住前 7 天、72 小时各复核一次；若超出预算，按同城候选顺序切换，不订无独卫、无热水或无法确认停车的房间。";

export const aliLhasaReturnPlanningReviewedAt = "2026-08-17";

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
        note: "2026 年 4 月 15 日起启用电子边境通行证，证件有效期最长 3 个月且免费办理。珠峰、普兰、札达等边境方向出发前逐项核对通行范围。",
        sourceLabel: "国家移民管理局 · 电子边境通行证问答",
        sourceUrl: "https://s.nia.gov.cn/mps/bszy/dzbjtxz/blzy/202604/t20260414_1001.html",
      },
      {
        subject: "拉萨租车与国庆还车",
        status: "必须提前",
        leadTime: "建议提前 30–60 天锁定四驱或高离地间车型",
        channel: "租车订单平台 + 门店书面确认",
        documents: "身份证、驾驶证、信用卡或平台要求的押金材料",
        note: "订单备注 G219/G317 长途使用、同城还车、救援范围、防滑链与备胎；取车时拍摄全车、轮胎、油量和里程，并把 10 月 6 日晚还车写入订单。",
        sourceLabel: "携程租车 · 实时车型与门店订单",
        sourceUrl: "https://car.ctrip.com/",
      },
    ],
    stay: {
      city: "拉萨市区",
      budget: standardRoomBudget,
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "如家商旅酒店（拉萨堆龙经济开发区店）",
          strengths: "免费停车、洗衣方便，靠近西出城方向；适合取车后整理装备，进老城游览需打车。",
          bookingUrl: "https://hotels.ctrip.com/hotels/29597640.html",
        },
        {
          name: "拉萨新气象酒店（八廓街店）",
          strengths: "近老城、停车评价较多，适合轻量适应；订房前电话确认院内车位和供氧房差价。",
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
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "如家精选富氧酒店（日喀则吉林南路店）",
          strengths: "供氧、免费停车和充电桩，出城前往珠峰顺路；优先确认双床供氧是否含在房价。",
          bookingUrl: "https://hotels.ctrip.com/hotels/129144954.html",
        },
        {
          name: "如家商旅酒店（日喀则汽车总站贡觉林卡店）",
          strengths: "免费停车、洗衣，靠近市区补给；作为富氧房超预算时的实用备选。",
          bookingUrl: "https://hotels.ctrip.com/hotels/80127997.html",
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
        subject: "珠峰景区次日门票与观光车",
        status: "建议提前",
        leadTime: "提前 1–3 天锁定门票和观光车，抵达定日后再次核验班次",
        channel: "正规在线旅游平台或景区售票渠道；不向个人转账买票",
        documents: "二代身份证、电子边境通行证；优惠人群带证件原件",
        note: "2026 年景区执行实名登记并需换乘观光车。购票后保存订单二维码，前一晚核对发车时间、风雪和开放区域。",
        sourceLabel: "西藏文旅厅 · 珠峰景区 2026 开放与实名规则",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202603/t20260316_529530.html",
      },
    ],
    stay: {
      city: "定日白坝片区",
      budget: standardRoomBudget,
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "汇峰酒店（珠峰小镇店）",
          strengths: "珠峰小镇入口附近、停车和充电方便，评价提到供氧与早班路餐；确认 9 月底供暖。",
          bookingUrl: "https://hotels.ctrip.com/hotels/131626747.html",
        },
        {
          name: "定日格桑花大酒店",
          strengths: "白坝镇内补给方便、免费停车，作为新酒店满房时的稳妥备选。",
          bookingUrl: "https://hotels.ctrip.com/hotels/46270495.html",
        },
      ],
    },
  },
  {
    day: 4,
    reservations: [
      {
        subject: "珠峰景区与绒布寺开放区域",
        status: "必须提前",
        leadTime: "前一晚完成订单、证件和首班观光车复核；建议提前 1–3 天购票",
        channel: "景区正规票务/在线旅游平台 + 定日游客换乘点",
        documents: "二代身份证、电子边境通行证、门票与观光车订单",
        note: "社会车辆按现场组织停放并换乘观光车；仅进入游客开放区域，不驶入绒布寺以上核心管制区。若停运或风雪加剧，直接取消珠峰折返。",
        sourceLabel: "西藏文旅厅 · 珠峰景区 2026 实名与观光车",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202603/t20260316_529530.html",
      },
    ],
    stay: {
      city: "萨嘎县城",
      budget: standardRoomBudget,
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "云水际·未来酒店（萨嘎店）",
          strengths: "独立停车场、供氧与自驾评价较好，适合珠峰长途日恢复；先确认房内供氧是否另收费。",
          bookingUrl: "https://hotels.ctrip.com/hotels/124069440.html",
        },
        {
          name: "如家酒店（萨嘎店）",
          strengths: "连锁型备选、县城补给方便；订前电话确认装修影响、停车位置与夜间热水。",
          bookingUrl: "https://hotels.corporatetravel.ctrip.com/hotels/131302999.html",
        },
      ],
    },
  },
  {
    day: 5,
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
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "天马国际富氧酒店（塔钦冈仁波齐风景区店）",
          strengths: "新开供氧型候选，目标价命中时优先；订前确认停车、地暖和供氧时段。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/ali97",
        },
        {
          name: "喜玛拉雅酒店（冈仁波齐景区店）",
          strengths: "停车方便、可供氧，位置适合次日出城；作为价格更稳定的候选交叉比价。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/ali97",
        },
      ],
    },
  },
  {
    day: 6,
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
        note: "未查到 2026 国庆统一强制预约条款；按正规开放道路进入，不驶入未开放土林沟谷。若线上出现分时票，立即改为实名预订。",
        sourceLabel: "西藏文旅厅 · 阿里智慧旅游平台",
        sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/xydt/202507/t20250718_490235.html",
      },
    ],
    stay: {
      city: "札达县城",
      budget: standardRoomBudget,
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "札达蓝森富氧酒店",
          strengths: "供氧、免费停车、电梯，近托林寺与县城餐饮；优先确认国庆双床是否仍在目标价。",
          bookingUrl: "https://hotels.ctrip.com/hotels/133349605.html",
        },
        {
          name: "芸苔酒店（托林店）",
          strengths: "近托林寺、免费停车和洗衣，价格超预算时可与蓝森交叉替换。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/undefined21290",
        },
      ],
    },
  },
  {
    day: 7,
    reservations: [
      {
        subject: "古格遗址公园",
        status: "建议提前",
        leadTime: "提前 1–3 天在小程序实名预订，前一晚核对首批入园时间",
        channel: "“智游阿里”微信小程序",
        documents: "二代身份证、电子边境通行证；保存订单二维码",
        note: "阿里官方智慧旅游平台已支持古格门票预订。国庆早场优先，避免古格排队挤压托林寺和离开札达盆地的时间。",
        sourceLabel: "西藏文旅厅 · 智游阿里古格预订",
        sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/xydt/202507/t20250718_490235.html",
      },
      {
        subject: "托林寺",
        status: "现场办理",
        leadTime: "前一晚查看开放时间；当天按古格结束时间决定是否进入",
        channel: "寺院正规售票窗口；如“智游阿里”出现票务则优先线上办理",
        documents: "二代身份证、电子边境通行证；优惠证件原件",
        note: "未查到 2026 散客强制提前预约公告。古格为主、托林寺为可压缩项，最迟下午离开札达。",
        sourceLabel: "西藏文旅厅 · 西藏 A 级景区名录",
        sourceUrl: "https://wlt.xizang.gov.cn/zwgk_69/gkml/ggfw/202510/t20251023_505529.html",
      },
    ],
    stay: {
      city: "狮泉河镇",
      budget: standardRoomBudget,
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "尚客优酒店（阿里噶尔县噶尔路店）",
          strengths: "供氧、免费停车、早餐，靠近客运与补给区域；适合全车检查日。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/gaer21068/h436",
        },
        {
          name: "云朵酒店（狮泉河店）",
          strengths: "停车场大、带洗衣与充电条件，作为连锁房满或超预算时的备选。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/gaer21068",
        },
      ],
    },
  },
  {
    day: 8,
    reservations: [
      {
        subject: "朋友昆莎机场返沪机票",
        status: "必须提前",
        leadTime: "建议提前 30–60 天出票，至少预留一班可退改的后备衔接方案",
        channel: "航空公司官方渠道；机场接送需另行与正规车辆书面确认",
        documents: "身份证、航班订单、行李额度与接送订单",
        note: "只适用于 10 月 5 日必须抵沪的朋友：当日不再随车去改则，独立从狮泉河前往昆莎机场。机票未出票或接送未落实，就不能视为有效分流。",
        sourceLabel: "西藏文旅厅 · 2026 阿里航线信息",
        sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/xydt/202603/t20260325_531189.html",
      },
      {
        subject: "G317 狮泉河至改则沿途观景",
        status: "无需预约",
        leadTime: "出发前 24 小时核对交通、天气和加油站状态",
        channel: "无票务渠道；只走 G317 主线和已开放停车点",
        documents: "身份证、驾驶证、车辆订单或行驶证、电子边境通行证备份",
        note: "革吉、雄巴属于补给/短停节点，不为追景驶入草场和无保障支路。当天真正需要提前锁定的是改则住宿和车辆救援联系方式。",
        sourceLabel: "西藏文旅厅 · 阿里北线线路资料",
        sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/wlyw/wldt/202507/t20250725_491772.html",
      },
    ],
    stay: {
      city: "改则县城",
      budget: standardRoomBudget,
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "速8精选酒店（阿里地区改则县 G216 店）",
          strengths: "供氧、新开业、近客运站；订前核对停车位和国庆标间实际价。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/Gertse21289",
        },
        {
          name: "汉庭酒店（阿里改则店）",
          strengths: "供氧、洗衣和连锁标准，适合作为长途日的同城替补。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/Gertse21289",
        },
      ],
    },
  },
  {
    day: 9,
    reservations: [
      {
        subject: "洞措与羌塘沿途观景",
        status: "无需预约",
        leadTime: "出发前 24 小时核对 G317 通行与风雪；不设置湖岸到达时间",
        channel: "无票务渠道；沿 G317 合法开放道路远观",
        documents: "身份证、驾驶证、车辆订单或行驶证",
        note: "没有可靠官方票务或强制预约信息。洞措不作为补给点，也不驶入盐碱地；若能见度下降，以到达尼玛县城为唯一目标。",
        sourceLabel: "西藏文旅厅 · 阿里北线线路资料",
        sourceUrl: "https://wlt.xizang.gov.cn/xwzx_69/wlyw/wldt/202507/t20250725_491772.html",
      },
    ],
    stay: {
      city: "尼玛县城",
      budget: standardRoomBudget,
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "尼玛凯枫大酒店",
          strengths: "可供氧、免费停车，县城成熟度较高；优先确认供氧方式和夜间热水。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/nyima21498",
        },
        {
          name: "尼玛秘境庄园民宿",
          strengths: "供氧、充电、洗衣和免费停车，适合作为酒店满房时的高评分备选。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/nyima21498/sl13595035",
        },
      ],
    },
  },
  {
    day: 10,
    reservations: [
      {
        subject: "色林措正规观景区域",
        status: "出发前复核",
        leadTime: "出发前 24 小时向尼玛/申扎当地文旅或 12345 核对开放与管制",
        channel: "未查到 2026 统一线上票务；以现场保护区和交通管理为准",
        documents: "身份证、驾驶证、车辆证件；如现场要求实名登记则配合办理",
        note: "色林措属于自然保护区域，只使用 G317 及正规开放观景点，不进入草场、湿地和湖滩。没有可靠预约入口时，不从非官方渠道购买所谓通行名额。",
        sourceLabel: "西藏自治区发改委 · 色林措景区规划资料",
        sourceUrl: "https://drc.xizang.gov.cn/zwgk_1941/fz/zxx/201806/P020200909428490530433.pdf",
      },
    ],
    stay: {
      city: "班戈县城",
      budget: standardRoomBudget,
      bookingAdvice: nationalDayHotelAdvice,
      hotels: [
        {
          name: "景禾供氧酒店",
          strengths: "供氧、免费停车、近主路且评价强调性价比；无电梯，重行李需提前确认楼层。",
          bookingUrl: "https://hotels.ctrip.com/hotels/124582616.html",
        },
        {
          name: "尚客优品酒店（班戈店）",
          strengths: "供氧、免费停车和连锁型设施，作为景禾无房或楼层不合适时的备选。",
          bookingUrl: "https://m.ctrip.com/webapp/hotel/bange21657/v0v149",
        },
      ],
    },
  },
  {
    day: 11,
    reservations: [
      {
        subject: "纳木措实名套票",
        status: "建议提前",
        leadTime: "提前 1–3 天实名购票，前一晚核对天气、入口和摆渡安排",
        channel: "景区官方正规渠道/“乃仓生活”微信入口，或现场正规窗口",
        documents: "二代身份证；优惠人群携带对应原件",
        note: "2026 年官方信息显示纳木措采用实名套票并可在 48 小时内不限次进出。本路线只走当日开放的常规观景区域，不临时追加圣象天门支线。",
        sourceLabel: "西藏文旅厅 · 纳木措 2026 实名套票",
        sourceUrl: "https://wlt.xizang.gov.cn/xccx/lytg/202606/t20260623_546718.html",
      },
    ],
    stay: {
      city: "拉萨市区",
      budget: standardRoomBudget,
      bookingAdvice: `${nationalDayHotelAdvice} 本晚优先与第一晚同店，减少搬运行李，并确认次日机场接驳。`,
      hotels: [
        {
          name: "如家商旅酒店（拉萨堆龙经济开发区店）",
          strengths: "靠近西侧与机场方向、免费停车，适合还车和次日离藏；可与第一晚连锁同订单。",
          bookingUrl: "https://hotels.ctrip.com/hotels/29597640.html",
        },
        {
          name: "拉萨新气象酒店（八廓街店）",
          strengths: "若还想短暂逛老城可选，停车评价较多；必须确认 10 月 6 日深夜到店保留房。",
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
        leadTime: "建议提前 30–60 天出票；10 月 6 日晚完成加油、验车和还车凭证",
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
