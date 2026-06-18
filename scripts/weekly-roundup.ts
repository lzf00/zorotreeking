/**
 * 每周日生成一篇"本周看点"mdx 写入 src/content/ai/weekly-YYYY-Www.mdx。
 *
 * 工作内容：
 *   1) 扫过去 7 天新增的 mdx（zh 版）
 *   2) 收集标题 / description，按 collection 分组
 *   3) 用豆包 chat 生成一段"本周观察" 200-300 字摘要
 *   4) 写入 mdx，frontmatter 含 [weekly, auto, roundup] tag（与 digest tag 区分）
 *
 * 触发：weekly-roundup.yml workflow，每周日北京 09:00（UTC 周日 01:00）。
 * 也可 workflow_dispatch 手动跑。
 *
 * 失败处理：单次 chat 失败 → 退回到"只列表不写观察"的兜底版。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./lib/llm.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Item {
  collection: string;
  key: string;
  title: string;
  description?: string;
  date: Date;
  isDigest: boolean;
}

function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayN = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayN);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

function parseFrontmatter(raw: string): Record<string, string> | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const obj: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const lm = line.match(/^(\w+):\s*"?([^"\n]+?)"?\s*$/);
    if (lm) obj[lm[1]] = lm[2];
  }
  return obj;
}

async function collectRecent(daysBack: number): Promise<Item[]> {
  const cutoff = Date.now() - daysBack * 86400000;
  const out: Item[] = [];
  for (const col of ["ai", "invest", "hike"]) {
    const dir = path.join(ROOT, "src", "content", col);
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".zh.mdx")) continue;
      const full = path.join(dir, f);
      const raw = await fs.readFile(full, "utf-8");
      const fm = parseFrontmatter(raw);
      if (!fm?.date || !fm?.title || !fm?.translationKey) continue;
      const dt = new Date(fm.date + "T00:00:00Z");
      if (dt.getTime() < cutoff) continue;
      const tagsRaw = (fm.tags ?? "").toString();
      const isDigest =
        tagsRaw.includes("digest") || fm.translationKey.startsWith("digest-") || fm.translationKey.startsWith("weekly-");
      out.push({
        collection: col,
        key: fm.translationKey,
        title: fm.title,
        description: fm.description,
        date: dt,
        isDigest,
      });
    }
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

async function generateObservation(items: Item[]): Promise<string> {
  const apiKey = process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY;
  if (!apiKey || items.length === 0) return "";

  const list = items.slice(0, 30).map((it) => `- [${it.collection}] ${it.title}${it.description ? ` — ${it.description}` : ""}`).join("\n");
  const prompt = `以下是 ZoroTreeking 站本周（过去 7 天）发布的内容标题与一句话描述：

${list}

请从一个个人博客作者的视角，写 200-300 字的"本周观察"短文（中文），覆盖：
1) 本周的几个主线主题或趋势
2) 哪些内容值得反复读 / 最具洞察
3) 一句话总结：本周读这些内容的人，能 take away 什么

要求：
- 自然语气，第一人称（"我"），不要用 markdown 列表
- 不要重复列举上面已经列出的每一篇
- 不要说"以下是本周观察"这种开场，直接进入
- 不要加任何 emoji
- 不要包含任何 markdown 语法标记`;

  try {
    const out = await chat(
      [
        { role: "system", content: "你是 ZoroTreeking 站长 Zoro 本人。写本周观察，自然真诚，不官腔。" },
        { role: "user", content: prompt },
      ],
      { temperature: 0.7, maxTokens: 1500, timeoutMs: 60_000 },
    );
    return out.trim();
  } catch (e: any) {
    console.warn(`[weekly] 观察生成失败: ${e?.message?.slice(0, 100)}`);
    return "";
  }
}

async function main() {
  const items = await collectRecent(7);
  if (items.length === 0) {
    console.log("[weekly] 本周没有新内容，跳过生成");
    return;
  }

  const today = new Date();
  const { year, week } = isoWeek(today);
  const weekStr = `${year}-W${String(week).padStart(2, "0")}`;
  const dateStr = today.toISOString().slice(0, 10);
  const outPath = path.join(ROOT, "src", "content", "ai", `weekly-${weekStr}.zh.mdx`);

  try {
    await fs.access(outPath);
    console.log(`[weekly] ${outPath.split("/").pop()} 已存在，跳过`);
    return;
  } catch {
    /* 不存在 → 继续生成 */
  }

  console.log(`[weekly] 本周新内容 ${items.length} 篇，生成 ${weekStr}...`);
  const observation = await generateObservation(items);

  // 按 collection 分组
  const groups: Record<string, Item[]> = {};
  for (const it of items) {
    (groups[it.collection] ??= []).push(it);
  }
  const collectionLabel: Record<string, string> = { ai: "AI 学习", invest: "投资", hike: "徒步", photo: "摄影" };

  const totals = {
    ai: groups.ai?.length ?? 0,
    invest: groups.invest?.length ?? 0,
    hike: groups.hike?.length ?? 0,
  };

  const lines: string[] = [];
  lines.push("---");
  lines.push("lang: zh");
  lines.push(`translationKey: weekly-${weekStr}`);
  lines.push(`title: "本周看点 · ${weekStr}"`);
  lines.push(`description: "AI ${totals.ai} · 投资 ${totals.invest} · 徒步 ${totals.hike} · 站长本周观察"`);
  lines.push(`date: ${dateStr}`);
  lines.push("tags: [weekly, auto, roundup]");
  lines.push("category: thoughts");
  lines.push("draft: false");
  lines.push("---");
  lines.push("");

  if (observation) {
    lines.push(observation);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // 列出本周所有内容
  for (const col of ["ai", "invest", "hike"]) {
    const list = groups[col];
    if (!list || list.length === 0) continue;
    lines.push(`## ${collectionLabel[col]}`);
    lines.push("");
    for (const it of list) {
      const date = it.date.toISOString().slice(0, 10);
      const flag = it.isDigest ? "" : " · 原创";
      lines.push(`- [${it.title}](/${col}/${it.key}/) · ${date}${flag}`);
    }
    lines.push("");
  }

  await fs.writeFile(outPath, lines.join("\n"), "utf-8");
  console.log(`[weekly] ✓ 写入 ${outPath.split("/").pop()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
