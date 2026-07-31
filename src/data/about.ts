export type AboutLang = "zh" | "en";

type AboutProfile = {
  name: string;
  tagline: string;
  photo?: string;
  intro: string;
  now: {
    working: string;
    reading: string;
    aiming: string;
  };
  stack: Array<{
    name: string;
    note: string;
  }>;
  projects: Array<{
    name: string;
    stage: string;
    desc: string;
  }>;
  books: Array<{
    title: string;
    author: string;
    why: string;
  }>;
  goals: string[];
  timeline: Array<{
    label: string;
    what: string;
  }>;
  links: Array<{
    href: string;
    label: string;
    icon: string;
  }>;
};

/**
 * About 页保留公开的能力方向与代表性经历，不保存可追溯的私人履历。
 * 禁止加入真实姓名、单位、学校、邮箱、精确年份和非公开项目规模。
 */
export const aboutData: Record<AboutLang, AboutProfile> = {
  zh: {
    name: "Zoro",
    tagline: "在代码与山林之间，留一份缓慢的笔记。",
    intro: `我长期关注自然语言处理、知识图谱与大模型 Agent，也持续把模型、数据和界面组合成真正可运行的系统。

经历覆盖中文信息抽取、文本分类与情感分析、知识图谱构建、多源数据融合、RAG、工具调用和自动化工作流。相比展示职位与单位，我更愿意保留解决问题的方法：理解业务、整理数据、实现模型、接入系统，再用测试与反馈验证结果。

ZoroTreeking 是这些实践之外的一份长期记录。这里有 AI 学习、市场观察、摄影和徒步；既记录技术怎样工作，也记录人怎样理解变化。`,
    now: {
      working: "持续打磨 LLM Agent、RAG、评测与自动化工作流",
      reading: "AI 论文 · Agent 工程 · 模型评测 · 数据系统",
      aiming: "把原型做成稳定、可维护、能被真实使用的系统",
    },
    stack: [
      { name: "Python", note: "NLP · 数据处理 · 自动化" },
      { name: "PyTorch", note: "模型训练 · 推理 · 评测" },
      { name: "LLM 应用", note: "RAG · 提示设计 · 模型接入" },
      { name: "Agent 工程", note: "任务编排 · 工具调用 · 状态管理" },
      { name: "知识图谱", note: "信息抽取 · 数据融合 · 图查询" },
      { name: "数据系统", note: "SQL · 数据管道 · 可观测性" },
      { name: "全栈开发", note: "Python 后端 · TypeScript · Astro" },
    ],
    projects: [
      {
        name: "ZoroTreeking",
        stage: "公开项目",
        desc: "个人内容与数据自动化实验场，包含双语内容、AI 摘要、市场数据、摄影相册、徒步记录和自动部署。",
      },
      {
        name: "LLM Agent 与业务自动化",
        stage: "近期实践",
        desc: "围绕长文本理解、数据分析和报告生成搭建 Agent 工作流，覆盖检索、工具调用、结果校验与运行监控。",
      },
      {
        name: "知识图谱与多源信息融合",
        stage: "工程实践",
        desc: "完成从文本抽取、实体关系建模、数据清洗融合到图数据库查询的完整链路，并服务于复杂信息分析。",
      },
      {
        name: "中文 NLP 信息抽取",
        stage: "算法实践",
        desc: "处理事件抽取、命名实体识别、文本分类和情感分析等任务，积累数据构建、训练、评测与部署经验。",
      },
      {
        name: "算法系统工程化",
        stage: "持续积累",
        desc: "把模型能力接入后端服务、数据管道和前端界面，关注稳定性、可维护性、边界条件与真实反馈。",
      },
    ],
    books: [
      { title: "活着", author: "余华", why: "生命本身的力量" },
      { title: "平凡的世界", author: "路遥", why: "普通人怎样活出光" },
      { title: "明朝那些事儿", author: "当年明月", why: "历史的必然与偶然" },
      { title: "雪中悍刀行", author: "烽火戏诸侯", why: "故事里的人物弧光" },
    ],
    goals: [
      "让 LLM Agent 从演示走向稳定、可维护的真实工作流",
      "从实现算法继续走向定义问题、设计方案与验证结果",
      "长期记录技术、市场、摄影与徒步中的真实观察",
      "保持数据驱动，也为不确定性留下空间",
    ],
    timeline: [
      { label: "基础积累", what: "学习计算机、机器学习与数据系统，形成算法与工程并重的基础。" },
      { label: "NLP 实践", what: "从中文信息抽取、文本分类和情感分析开始处理非结构化信息。" },
      { label: "图谱工程", what: "将信息抽取扩展到知识图谱、多源数据融合与复杂关系分析。" },
      { label: "Agent 工程", what: "转向大模型应用，实践 RAG、工具调用、任务编排、评测与监控。" },
      { label: "持续迭代", what: "建设 ZoroTreeking，并持续把学习、系统实践与真实世界记录在一起。" },
    ],
    links: [
      { href: "/rss.xml", label: "RSS", icon: "📡" },
      { href: "/subscribe", label: "订阅邮件", icon: "✉️" },
      { href: "/guestbook", label: "留言板", icon: "💬" },
    ],
  },
  en: {
    name: "Zoro",
    tagline: "Slow notes from between code and mountains.",
    intro: `My work has long focused on natural language processing, knowledge graphs and LLM agents, with an equal interest in turning models, data and interfaces into systems that actually run.

The experience spans Chinese information extraction, text classification and sentiment analysis, knowledge-graph construction, multi-source data fusion, RAG, tool use and automated workflows. Instead of listing employers and titles, this page keeps the method: understand the problem, organise the data, build the model, connect the system, then verify the result with tests and feedback.

ZoroTreeking is a long-running record beside that work. It brings together AI learning, market observations, photography and hiking — how technology works, and how people make sense of change.`,
    now: {
      working: "Refining LLM agents, RAG, evaluation and automated workflows",
      reading: "AI papers · Agent engineering · Model evaluation · Data systems",
      aiming: "Turn prototypes into stable, maintainable systems people can actually use",
    },
    stack: [
      { name: "Python", note: "NLP · Data processing · Automation" },
      { name: "PyTorch", note: "Training · Inference · Evaluation" },
      { name: "LLM Applications", note: "RAG · Prompt design · Model integration" },
      { name: "Agent Engineering", note: "Orchestration · Tool use · State management" },
      { name: "Knowledge Graphs", note: "Extraction · Data fusion · Graph queries" },
      { name: "Data Systems", note: "SQL · Pipelines · Observability" },
      { name: "Full Stack", note: "Python backend · TypeScript · Astro" },
    ],
    projects: [
      {
        name: "ZoroTreeking",
        stage: "Public project",
        desc: "A personal publishing and data-automation lab with bilingual content, AI summaries, market data, photo stories, hiking notes and automated delivery.",
      },
      {
        name: "LLM Agents and Workflow Automation",
        stage: "Recent practice",
        desc: "Agent workflows for long-document understanding, data analysis and report generation, covering retrieval, tool use, result validation and operational monitoring.",
      },
      {
        name: "Knowledge Graphs and Data Fusion",
        stage: "Engineering practice",
        desc: "End-to-end work from text extraction, entity and relation modelling, and data cleaning to graph storage, queries and complex-information analysis.",
      },
      {
        name: "Chinese NLP Information Extraction",
        stage: "Algorithm practice",
        desc: "Event extraction, named-entity recognition, text classification and sentiment analysis, including dataset design, training, evaluation and deployment.",
      },
      {
        name: "Productionising Algorithm Systems",
        stage: "Ongoing",
        desc: "Connecting model capabilities to backend services, data pipelines and interfaces, with attention to reliability, maintainability and real feedback.",
      },
    ],
    books: [
      { title: "To Live", author: "Yu Hua", why: "The force of life itself" },
      { title: "Ordinary World", author: "Lu Yao", why: "How ordinary people find their light" },
      { title: "Those Things About the Ming Dynasty", author: "Dangnian Mingyue", why: "History, inevitability and chance" },
      { title: "Sword Snow Stride", author: "Fenghuo Xizhuhou", why: "Character arcs inside a long story" },
    ],
    goals: [
      "Move LLM agents from demonstrations into stable, maintainable workflows",
      "Keep growing from implementing algorithms to defining problems and validating solutions",
      "Record honest observations across technology, markets, photography and hiking",
      "Stay data-driven while leaving room for uncertainty",
    ],
    timeline: [
      { label: "Foundations", what: "Built a foundation across computing, machine learning and data systems." },
      { label: "NLP Practice", what: "Started with Chinese information extraction, text classification and sentiment analysis." },
      { label: "Graph Engineering", what: "Extended extraction into knowledge graphs, data fusion and complex-relation analysis." },
      { label: "Agent Engineering", what: "Moved into LLM applications through RAG, tool use, orchestration, evaluation and monitoring." },
      { label: "Continuous Work", what: "Built ZoroTreeking to keep learning, system practice and real-world notes together." },
    ],
    links: [
      { href: "/rss.xml", label: "RSS", icon: "📡" },
      { href: "/en/subscribe", label: "Subscribe", icon: "✉️" },
      { href: "/en/guestbook", label: "Guestbook", icon: "💬" },
    ],
  },
};

export type AboutData = typeof aboutData;
