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

  intro: `我涉旷野丛林而来。

我是刘子非，朋友们叫我 Zoro。上海某网络安全公司的算法研究员，日常做 NLP、知识图谱、大模型 Agent —— 简单说就是「让机器读懂网络流量、威胁情报、销售报表、周报邮件里那些非结构化的中文」。

技术栈这几年从"BERT + 命名实体识别"演进到"LLM + Agent + 全栈开发"。做过千万级省级科研项目的独立申报，也在把大模型落到 AI 视频巡检、合规审查、销售分析、周报生成这些具体业务里。

写这个站源自一个简单的念头：把读过的论文、看过的市场、走过的山路都记录下来。算法越来越快，但理解需要慢。所以这里同时有 AI 论文的中文笔记、A 股 / 港股的实时看板、徒步路线的轨迹日志，以及相机里捕捉的瞬间。

无算法，无推送，无广告。如果你也觉得"慢一点"是种奢侈，欢迎留下来读一篇。`,

  now: {
    working: "大模型 Agent 落地业务：AI 视频巡检 / 合规审查 / 数据分析 / 周报生成",
    reading: "HF Daily Papers · Anthropic 的 Constitutional AI · 各类 Agent 框架论文",
    aiming: "让 LLM Agent 真正跑通业务闭环 · 走遍中国 30 座山",
  },

  timeline: [
    { year: "2016", what: "湖北警官学院 · 计算机科学与技术本科" },
    { year: "2020", what: "湖北大学 · 网络空间安全硕士 · 研究方向 NLP + 知识图谱" },
    { year: "2022", what: "中科苏州实习：金融 NLP · UIE 事件抽取 · 情感分析" },
    { year: "2023", what: "加入上海飞旗 · 算法研究员 · 网络安全 AI 方向" },
    { year: "2024", what: "主导威胁情报知识图谱系统（100 万+ 实体 / 1000 万+ 关系）· 独立申报千万级省级科研项目" },
    { year: "2025", what: "转向大模型 Agent · 落地 AI 视频巡检 / 合规审查 / 销售分析 / 周报系统等业务闭环" },
    { year: "2026", what: "启动 ZoroTreeking · 把代码与山林记录在一起" },
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

  // 技术栈（按类别，日常主力→次要）
  stack: [
    { name: "Python", note: "主力语言 · NLP · ML" },
    { name: "PyTorch", note: "深度学习" },
    { name: "SQL", note: "ClickHouse · Doris · MySQL" },
    { name: "LLM 工程化", note: "DeepSeek / Claude / Kimi · 大模型微调与部署" },
    { name: "Agent 开发", note: "任务编排 · 工具调用 · 业务闭环" },
    { name: "全栈开发", note: "Python 后端 · TypeScript / Astro 前端" },
    { name: "Nebula / Neo4j", note: "图数据库 · 百万级实体" },
    { name: "网络安全", note: "威胁情报 · 流量分析 · CISP 认证" },
  ] as Array<{ name: string; note?: string; years?: number }>,

  // 我做过的项目（按时间倒序，代表性 5 个）
  projects: [
    {
      name: "ZoroTreeking",
      period: "2026 -",
      desc: "个人博客 + 数据自动化实验场。Astro 4 · 5 类内容自动化流水线（AI digest / 港股 A 股实时看板 / ETF 三因子 / 摄影相册 / 徒步轨迹）· 中英双语 · 大模型翻译 + 摘要 pipeline",
      url: "https://github.com/lzf00/zorotreeking",
    },
    {
      name: "大模型 Agent 业务落地（6 类场景）",
      period: "2025 -",
      desc: "把 LLM 从 demo 推到业务闭环。基于 Function Calling + 多 Agent 编排 + RAG 的技术栈，覆盖 6 类真实场景：AI 视频巡检（VLM 异常检测）· 合规审查（长文本条款抽取）· 优化算法（业务参数调优）· 爬虫系统 · 销售数据分析 · 周报自动生成。端到端工程链路（数据 → 模型 → 评测 → 部署 → 监控），显著节省人工投入。",
    },
    {
      name: "多维威胁情报采集融合系统",
      period: "2024 -",
      desc: "网络安全事件知识图谱全流程构建：本地大模型微调抽取 · 多源数据融合（准确率 +10%）· Nebula 存储 100 万+ 实体 / 1000 万+ 关系",
    },
    {
      name: "威胁线索与身份挖掘系统",
      period: "2024 -",
      desc: "海量人员及电信业务数据分析 · 聚类图算法秒级分析 10w+ 数据 · Doris + Nebula 百万级多源情报一体化实时入库",
    },
    {
      name: "省级科研项目 · 威胁线索追踪与路径优化",
      period: "2024",
      desc: "独立完成撰写和申报全流程（千万级资金）：稀疏计算 · 威胁情报信息抽取 · 知识图谱 · 前期指南阅读到答辩汇报全程",
    },
  ] as Array<{ name: string; period: string; desc: string; url?: string }>,

  // 长期兴趣 / 目标（不追 KPI，追方向）
  goals: [
    "把 LLM Agent 真正跑通业务闭环 —— 不只是 demo，而是能替代真实工作流的那种",
    "从「实现算法」进化到「提出问题 + 定义解决方案」—— 少写工程多想边界",
    "走遍中国 30 座山 · 每年至少 4 次中长距离徒步",
    "投资哲学：数据驱动 · 价值投资 · 长期持有 · 不停修炼",
  ],

  // 英文版（en/about 用）。不填则跌回 zh 中文内容
  en: {
    tagline: "Slow notes from between code and mountains.",
    intro: `I come from wilderness and woodland.

I'm Zifei Liu, aka Zoro. Algorithm researcher at a cybersecurity company in Shanghai. Day-to-day I work on NLP, knowledge graphs, and LLM agents — essentially teaching machines to read unstructured Chinese: network traffic, threat intel, sales reports, weekly-report emails.

My tech stack has evolved from "BERT + NER" to "LLM + Agents + full-stack." I've led the solo application of a tens-of-millions-yuan provincial research project, and I'm putting large models into real production: AI video inspection, compliance review, sales analysis, weekly-report generation.

This site is a slow record of what I read, watch, and walk through — AI paper notes in Chinese, live A-share / HK-market dashboards, hiking trails, and camera moments. Algorithms are getting faster, but understanding takes time.

No algorithm. No push. No ads. If "slow" still sounds like a luxury, stay for one piece.`,
    now: {
      working: "Bringing LLM agents into real business loops (AI ops · compliance · analytics · reports)",
      reading: "HF Daily Papers · Anthropic Constitutional AI · Agent framework papers",
      aiming: "Ship a full-loop LLM agent · Walk 30 mountains across China",
    },
    timeline: [
      { year: "2016", what: "Bachelor in CS · Hubei Police Officer Academy" },
      { year: "2020", what: "Master in Cybersecurity · Hubei University · NLP + Knowledge Graph focus" },
      { year: "2022", what: "NLP intern at Suzhou Institute · Financial UIE + sentiment analysis" },
      { year: "2023", what: "Joined Shanghai Feiqi · Algorithm researcher · Cybersecurity AI" },
      { year: "2024", what: "Led threat-intel knowledge graph (1M+ entities / 10M+ relations) · Solo application of a tens-of-millions-yuan provincial research project" },
      { year: "2025", what: "Shifted to LLM Agents · Production loops for AI ops / compliance / sales / weekly-report" },
      { year: "2026", what: "Launched ZoroTreeking — code and mountains together" },
    ],
    books: [
      { title: "To Live", author: "Yu Hua", why: "The raw power of life itself" },
      { title: "Ordinary World", author: "Lu Yao", why: "How ordinary people shine" },
      { title: "Those Things about the Ming Dynasty", author: "Dangnian Mingyue", why: "History's inevitable and its accidents" },
      { title: "Sword Snow Stride", author: "Fenghuo Xizhuhou", why: "Character arcs in wuxia" },
    ] as Array<{ title: string; author?: string; why?: string }>,
    stack: [
      { name: "Python", note: "Main · NLP · ML · Full-stack" },
      { name: "PyTorch", note: "Deep learning" },
      { name: "SQL", note: "ClickHouse · Doris · MySQL" },
      { name: "LLM ops", note: "DeepSeek / Claude / Kimi · Model fine-tuning & deployment" },
      { name: "Agent development", note: "Task orchestration · Tool calls · Business loops" },
      { name: "Full-stack", note: "Python backend · TypeScript / Astro frontend" },
      { name: "Nebula / Neo4j", note: "Graph DB · Millions of entities" },
      { name: "Cybersecurity", note: "Threat intel · Traffic analysis · CISP certified" },
    ] as Array<{ name: string; note?: string; years?: number }>,
    projects: [
      { name: "ZoroTreeking", period: "2026 -", desc: "Personal blog + data-automation lab. Astro 4 · Multi-pipeline auto content (AI digest / A-share & HK live dashboards / ETF three-factor / photo albums / hiking GPX) · Bilingual · LLM translation + summarization pipeline.", url: "https://github.com/lzf00/zorotreeking" },
      { name: "LLM Agent business loops (6 scenarios)", period: "2025 -", desc: "From demo to production business loops. Stack based on Function Calling + multi-agent orchestration + RAG. Covers 6 real scenarios: AI video inspection (VLM anomaly detection) · Compliance review (long-doc term extraction) · Optimization algorithms (business-parameter tuning) · Crawler systems · Sales analytics · Auto weekly reports. End-to-end pipeline (data → model → eval → deploy → monitor) with significant manpower savings." },
      { name: "Multi-source Threat Intel Fusion System", period: "2024 -", desc: "End-to-end cybersecurity knowledge graph: local LLM fine-tuning for extraction · Multi-source fusion (+10% accuracy) · Nebula storing 1M+ entities / 10M+ relations." },
      { name: "Threat Lead & Identity Mining System", period: "2024 -", desc: "Mass personnel + telecom data analysis · Clustering graph algo processing 100k+ records at second-latency · Doris + Nebula real-time multi-source intel pipeline." },
      { name: "Provincial Research · Threat Trail & Path Optimization", period: "2024", desc: "Solo-led the full application (tens-of-millions-yuan funding): sparse computing · threat intel extraction · knowledge graph · from guideline reading to defense presentation." },
    ] as Array<{ name: string; period: string; desc: string; url?: string }>,
    goals: [
      "Ship an LLM agent that truly runs a business loop — not a demo, but replacing real workflows",
      "Evolve from «implementing algorithms» to «defining problems + shaping solutions»",
      "Walk 30 mountains across China · At least 4 long-distance hikes a year",
      "Investing philosophy: data-driven · value investing · long-hold · never stop cultivating",
    ],
  },
};

export type AboutData = typeof aboutData;
