/**
 * /about 页"我是谁"模块的单一信息源。
 * 改这一个文件就能更新整个 about 页。
 *
 * 字段说明：
 *   photo     头像 / 个人照片。public/about/xxx.jpg 这种相对站根路径；
 *             undefined 时自动用 initials 圈兜底（也是看着挺像那么回事的）
 *   intro     200-300 字自述。段落用 \n\n 分隔
 *   now       三块"当下状态"，每块 ≤50 字
 *   timeline  时间线，旧 → 新，每条一句话
 *   contact   联系方式 / 社交链接
 *   en        英文版的对应字段（不填则 en/about 页用默认英文兜底）
 */

export const aboutData = {
  name: "Zifei Liu",
  alias: "Zoro",
  tagline: "在代码与山林之间，留一份缓慢的笔记。",

  // 放一张 4:3 或 7:4 的横版照片到 public/about/，比如 public/about/portrait.jpg
  // 然后这里写 "/about/portrait.jpg"。留空就用 initials 圈兜底。
  photo: undefined as string | undefined,

  intro: `我是 Zifei Liu，朋友们叫我 Zoro。日常是软件工程师，工作在数据与 AI 的交叉地带。

写这个站源自一个简单的念头：把读过的论文、看过的市场、走过的山路都记录下来。算法越来越快，但理解需要慢。所以这里同时有 AI 论文的中文笔记、A 股 / 港股的周度复盘、徒步路线的轨迹日志，以及相机里捕捉的瞬间。

无算法，无推送，无广告。如果你也觉得"慢一点"是种奢侈，欢迎留下来读一篇。`,

  now: {
    working: "深耕 AI 研究与工程实践，搭建个人知识管理系统",
    reading: "Hugging Face Daily Papers · Anthropic 最新 RLHF 工作",
    aiming: "今年完成 12 篇深度论文笔记 + 4 次中长距离徒步",
  },

  timeline: [
    { year: "2017", what: "本科毕业，开始第一份工程师工作" },
    { year: "2019", what: "深入大数据基础设施，第一次接触机器学习项目" },
    { year: "2021", what: "转向 AI 方向，参与模型工程化落地" },
    { year: "2023", what: "周末开始徒步，第一次走完一条 30+ 公里的线路" },
    { year: "2026", what: "启动 ZoroTreeking，把代码与山林记录在一起" },
  ],

  contact: {
    email: "1437066318@qq.com",
    github: "https://github.com/lzf00",
    wechat_official: "BossCat1024",   // 微信公众号
    rss: "/rss.xml",
  },

  // 影响我的书（人文向 —— 平衡技术站的机器味）
  books: [
    { title: "活着", author: "余华", why: "生命本身的力量" },
    { title: "平凡的世界", author: "路遥", why: "普通人怎么活出光" },
    { title: "明朝那些事儿", author: "当年明月", why: "历史的必然与偶然" },
    { title: "雪中悍刀行", author: "烽火戏诸侯", why: "武侠里的人物弧光" },
  ],

  // 技术栈 —— 待用户补充。空数组时前端不显示这块。
  stack: [] as Array<{ name: string; note?: string; years?: number }>,

  // 我做过的项目 —— 待用户补充
  projects: [] as Array<{ name: string; period: string; desc: string; url?: string }>,

  // 长期兴趣 / 目标
  goals: [] as string[],

  // 英文版（en/about 用）。不填则跌回 zh 中文内容
  en: {
    tagline: "Slow notes from between code and mountains.",
    intro: `I'm Zifei Liu, also known online as Zoro. By day I'm a software engineer working at the intersection of data and AI.

I started this site to keep slow records of what I read, watch, and walk through — papers, markets, mountain trails, and the moments my camera catches. Algorithms are getting faster, but understanding takes time. So you'll find Chinese-language paper notes on AI research, weekly recaps of China A-shares and HK markets, hiking trip reports, and the occasional photo set.

No algorithm. No push. No ads. If "slow" still sounds like a luxury to you, stay for one piece.`,
    now: {
      working: "Working on AI research & engineering · building a personal knowledge stack",
      reading: "HF Daily Papers · Anthropic's recent RLHF work",
      aiming: "12 deep paper notes + 4 long-distance hikes this year",
    },
    timeline: [
      { year: "2017", what: "Graduated; started my first engineering job" },
      { year: "2019", what: "Deep into data infrastructure; first ML project" },
      { year: "2021", what: "Pivoted to AI; worked on production model deployment" },
      { year: "2023", what: "Started weekend hiking; finished my first 30+ km trail" },
      { year: "2026", what: "Launched ZoroTreeking to record code and mountains together" },
    ],
  },
};

export type AboutData = typeof aboutData;
