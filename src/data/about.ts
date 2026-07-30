export type AboutLang = "zh" | "en";

type AboutCopy = {
  eyebrow: string;
  title: string;
  tagline: string;
  intro: string[];
  craftLabel: string;
  craft: Array<{
    index: string;
    title: string;
    text: string;
  }>;
  pathsLabel: string;
  pathsIntro: string;
  paths: Array<{
    key: "ai" | "invest" | "photo" | "hike";
    href: string;
    label: string;
    title: string;
    description: string;
    color: string;
  }>;
  principlesLabel: string;
  principles: Array<{
    title: string;
    text: string;
  }>;
  privacyLabel: string;
  privacyTitle: string;
  privacyText: string;
  privacyLink: string;
  privacyLinkLabel: string;
  pulseLabel: string;
  ctaTitle: string;
  ctaText: string;
  ctaPrimary: string;
  ctaSecondary: string;
};

/**
 * About 页只描述站点、公开内容与工作方法。
 * 个人身份、履历、联系方式和内部项目数据不得写入此对象。
 */
export const aboutData: Record<AboutLang, AboutCopy> = {
  zh: {
    eyebrow: "ABOUT · ZOROTREEKING",
    title: "这里不放简历，\n只说明为什么写。",
    tagline: "在代码与山林之间，留一份缓慢的笔记。",
    intro: [
      "ZoroTreeking 是一份持续生长的个人编辑项目。这里把 AI、市场、摄影和徒步放在同一张桌面上：一边理解快速变化的技术与数据，一边保留真实世界的光线、路径和体感。",
      "参考专业经历所形成的方法，但不复制履历本身：先从复杂信息里找出结构，再把想法做成可运行的系统，最后用测试、反馈与复盘验证结果。公开的是作品与思考，不是私人档案。",
    ],
    craftLabel: "HOW IT IS MADE · 如何形成内容",
    craft: [
      {
        index: "01",
        title: "先理解",
        text: "从语言、数据与现实问题中辨认结构，把模糊问题拆成可以讨论的部分。",
      },
      {
        index: "02",
        title: "再实现",
        text: "让模型、数据和界面协同工作，把一次性的想法变成可以运行、可以维护的系统。",
      },
      {
        index: "03",
        title: "后验证",
        text: "用来源、测试、反馈与复盘校正判断。结果比术语重要，边界和不确定性同样要写清楚。",
      },
    ],
    pathsLabel: "FOUR PATHS · 四条内容路径",
    pathsIntro: "不按职位或履历组织内容，只按长期关注的问题分类。",
    paths: [
      {
        key: "ai",
        href: "/ai",
        label: "01 / INTELLIGENCE",
        title: "AI 学习",
        description: "论文、模型、Agent 与真实系统之间的距离。",
        color: "#1d4ed8",
      },
      {
        key: "invest",
        href: "/invest",
        label: "02 / MARKETS",
        title: "个人投资",
        description: "市场数据、投资框架与持续修正的判断。",
        color: "#991b1b",
      },
      {
        key: "photo",
        href: "/photo",
        label: "03 / LIGHT",
        title: "摄影",
        description: "相机留下的光线、秩序和偶然时刻。",
        color: "#6b21a8",
      },
      {
        key: "hike",
        href: "/hike",
        label: "04 / TRAILS",
        title: "徒步",
        description: "路线、地形与身体走过之后留下的记录。",
        color: "#166534",
      },
    ],
    principlesLabel: "EDITORIAL NOTES · 编辑原则",
    principles: [
      {
        title: "来源可追",
        text: "尽量给事实、数据和判断留下出处。",
      },
      {
        title: "过程可见",
        text: "不只展示结论，也记录方法、失败和修正。",
      },
      {
        title: "隐私优先",
        text: "公开作品与方法，默认收起无关的个人与业务信息。",
      },
    ],
    privacyLabel: "PRIVACY BY DEFAULT",
    privacyTitle: "公开作品，不公开私人档案。",
    privacyText:
      "本页刻意省略真实身份、任职单位、教育履历、联系方式、精确时间线，以及未公开项目的名称、数据和规模。必要的站点合规与联系入口独立放置，不与个人介绍混在一起。",
    privacyLink: "/privacy",
    privacyLinkLabel: "查看隐私说明",
    pulseLabel: "SITE PULSE · 内容脉搏",
    ctaTitle: "从一条感兴趣的路径开始。",
    ctaText: "这里没有推荐算法，也不需要先认识作者。选一个主题，直接阅读。",
    ctaPrimary: "开始阅读 AI",
    ctaSecondary: "订阅 RSS",
  },
  en: {
    eyebrow: "ABOUT · ZOROTREEKING",
    title: "No résumé here.\nOnly the reason for writing.",
    tagline: "Slow notes from between code and mountains.",
    intro: [
      "ZoroTreeking is an evolving independent editorial project. It puts AI, markets, photography and hiking on the same desk: making sense of fast-moving technology and data while keeping room for light, terrain and lived experience.",
      "The method comes from professional practice without reproducing a private résumé: find structure in complex information, turn ideas into working systems, then test them against evidence, feedback and reflection. The work is public; the personal file is not.",
    ],
    craftLabel: "HOW IT IS MADE",
    craft: [
      {
        index: "01",
        title: "Understand",
        text: "Find structure in language, data and real-world problems, then turn ambiguity into questions that can be examined.",
      },
      {
        index: "02",
        title: "Build",
        text: "Let models, data and interfaces work together so a one-off idea becomes a system that can run and be maintained.",
      },
      {
        index: "03",
        title: "Verify",
        text: "Use sources, tests, feedback and retrospection to correct the result. Boundaries and uncertainty belong in the record too.",
      },
    ],
    pathsLabel: "FOUR PATHS",
    pathsIntro: "The archive is organised by enduring questions, not by job titles or chronology.",
    paths: [
      {
        key: "ai",
        href: "/en/ai",
        label: "01 / INTELLIGENCE",
        title: "AI Learning",
        description: "The distance between papers, models, agents and working systems.",
        color: "#1d4ed8",
      },
      {
        key: "invest",
        href: "/en/invest",
        label: "02 / MARKETS",
        title: "Personal Investing",
        description: "Market data, investment frameworks and judgments that stay open to revision.",
        color: "#991b1b",
      },
      {
        key: "photo",
        href: "/en/photo",
        label: "03 / LIGHT",
        title: "Photography",
        description: "Light, order and chance moments kept by a camera.",
        color: "#6b21a8",
      },
      {
        key: "hike",
        href: "/en/hike",
        label: "04 / TRAILS",
        title: "Hiking",
        description: "Routes, terrain and notes left after walking through them.",
        color: "#166534",
      },
    ],
    principlesLabel: "EDITORIAL NOTES",
    principles: [
      {
        title: "Trace the source",
        text: "Facts, data and judgments should leave a path back to their evidence.",
      },
      {
        title: "Show the process",
        text: "Record methods, failures and corrections instead of presenting only the answer.",
      },
      {
        title: "Privacy first",
        text: "Publish the work and the method; keep unrelated personal and business details out.",
      },
    ],
    privacyLabel: "PRIVACY BY DEFAULT",
    privacyTitle: "Public work, not a public personal file.",
    privacyText:
      "This page deliberately omits legal identity, employers, education history, contact details, precise timelines, and the names, metrics or scale of non-public projects. Site compliance and contact routes remain separate from this introduction.",
    privacyLink: "/en/privacy",
    privacyLinkLabel: "Read the privacy note",
    pulseLabel: "SITE PULSE",
    ctaTitle: "Start with one path that interests you.",
    ctaText: "There is no recommendation algorithm and no need to know the author first. Pick a subject and read.",
    ctaPrimary: "Start with AI",
    ctaSecondary: "Follow via RSS",
  },
};
