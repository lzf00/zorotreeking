/**
 * /uses 页内容源。indie web 传统：列出"我用什么"工具栈。
 * 改这一个文件就能更新整个页面。
 *
 * 每个条目: { name, note?, url? }
 * note 不写或为空就只显示 name。
 */

export const usesData = {
  intro: `我用得久的工具，按 "几乎每天都用" 排序。不追新，迁移成本高于边际收益的不换。`,

  groups: [
    {
      title: "Editor & Terminal",
      items: [
        { name: "VS Code", note: "Vim 插件 + Copilot；主力 IDE" },
        { name: "Claude Code", note: "命令行 AI 编程助手，写这个站的搭档" },
        { name: "iTerm2 + zsh + Starship", note: "终端三件套" },
        { name: "Cursor", note: "偶尔用，重 AI 编辑场景" },
      ],
    },
    {
      title: "Browser & Reading",
      items: [
        { name: "Chrome", note: "工作；扩展极简" },
        { name: "Arc", note: "实验，喜欢 Easel" },
        { name: "Reeder 5", note: "RSS 阅读器" },
        { name: "Pocket", note: "稍后读" },
      ],
    },
    {
      title: "AI & Data",
      items: [
        { name: "豆包 / 火山方舟", note: "中文场景主力 LLM，便宜质量稳" },
        { name: "Anthropic Claude", note: "深度推理 + 长上下文" },
        { name: "ChatGPT", note: "兜底" },
        { name: "Hugging Face", note: "看 daily papers + 模型仓库" },
        { name: "Jupyter / VS Code Notebook", note: "数据探索" },
      ],
    },
    {
      title: "Site Stack",
      items: [
        { name: "Astro 4", note: "本站静态生成框架", url: "https://astro.build" },
        { name: "Tailwind CSS", note: "样式" },
        { name: "MDX", note: "文章格式" },
        { name: "Pagefind", note: "客户端全文搜索（无后端）", url: "https://pagefind.app" },
        { name: "satori + resvg", note: "build 时生成 og:image" },
        { name: "豆包 embedding", note: "相关文章语义匹配" },
        { name: "Buttondown", note: "邮件订阅托管", url: "https://buttondown.email" },
        { name: "Cloudflare Worker", note: "Decap CMS OAuth 代理" },
      ],
    },
    {
      title: "Hardware",
      items: [
        { name: "MacBook Pro M3 Pro", note: "16GB / 1TB" },
        { name: "iPhone 15 Pro", note: "" },
        { name: "Sony α7C II", note: "出片机；35mm + 85mm 定焦" },
        { name: "HOKA Speedgoat 5", note: "徒步主力鞋" },
      ],
    },
    {
      title: "Productivity",
      items: [
        { name: "Notion", note: "知识库 + 任务" },
        { name: "Things 3", note: "GTD" },
        { name: "Raycast", note: "Spotlight 替代" },
        { name: "1Password", note: "密码 + 2FA" },
      ],
    },
  ],

  footer: `这份清单不算"推荐"，只是记录我自己怎么用。换工具的频率 ≈ 每年 1-2 个，要换通常因为旧工具的核心承诺没兑现，而不是新工具更花哨。`,
};

export type UsesData = typeof usesData;
