/**
 * 错别字 / 语病 LLM 检查脚本。
 *
 * 用豆包扫 digest 内容（中文），找：
 *   - 错别字（同音字、形近字）
 *   - 明显的语病、不通顺
 *   - 数字 / 日期不一致
 *   - 半截截断、损坏标点
 *
 * 设计：
 *   - 每篇文章只扫 mdx body 文本部分（去掉 frontmatter / JSX）
 *   - 单篇 prompt 限制：~3000 字符（避免大文件 token 爆炸）；超长分块
 *   - 输出 JSON 报告，列出建议的修改（不自动应用，由人审核）
 *
 * 用法：
 *   npx tsx scripts/check-typos.ts                       # 扫最新 5 篇
 *   npx tsx scripts/check-typos.ts --limit=20            # 扫最新 20 篇
 *   npx tsx scripts/check-typos.ts --section=ai          # 单栏目
 *   npx tsx scripts/check-typos.ts --since=2026-06-01    # 这日期后的
 *
 * 报告写到 reports/typos-YYYY-MM-DD.json
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./lib/llm.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);

const LIMIT = (() => {
  const m = ARGS.find((a) => a.startsWith("--limit="));
  return m ? parseInt(m.split("=")[1], 10) || 5 : 5;
})();
const SECTION = (() => {
  const m = ARGS.find((a) => a.startsWith("--section="));
  return m ? m.split("=")[1] : null;
})();
const SINCE = (() => {
  const m = ARGS.find((a) => a.startsWith("--since="));
  return m ? m.split("=")[1] : null;
})();

const SYS_PROMPT = `你是中文编辑助手，专门帮博客作者发现内容中的错别字、语病、不通顺、半截截断等问题。

输入是一篇文章的部分文本。请你输出一个严格 JSON：

{
  "issues": [
    {
      "type": "typo|grammar|number|broken",
      "context": "出问题的那 30-50 字（原文片段）",
      "suggest": "建议改成什么"
    }
  ]
}

要求：
- 只列出真正有把握的问题，宁缺勿滥。
- 跳过专有名词（OpenAI / arXiv / Codex / GPT-5 / Hugging Face 等）。
- 跳过明显是英文论文标题或外文人名的部分。
- 不要把数字单位（k/w/亿）当错别字。
- 没找到任何问题就输出 {"issues": []}。
- 输出严格 JSON，不要 markdown 代码块包装。`;

type Issue = { type: string; context: string; suggest: string };

function stripMdx(body: string): string {
  return body
    // 去掉 import 行
    .replace(/^import .+$/gm, "")
    // 去掉 JSX 块：<FeedbackButtons .../>、<div className="...">...</div>
    .replace(/<[A-Z]\w*\b[^>]*(?:\/>|>[\s\S]*?<\/[A-Z]\w*>)/g, "")
    .replace(/<div[^>]*className=[\s\S]*?<\/div>/g, "")
    // 去掉 H2/H3 头部的 <a> 标签
    .replace(/<a\s+href[^>]*>([^<]*)<\/a>/g, "$1")
    // 去掉 *meta info* 行（HF ★ N · 作者...）
    .replace(/^\*[^*]+\*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text: string, maxLen: number = 3000): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if (cur.length + para.length + 2 > maxLen) {
      if (cur) chunks.push(cur);
      cur = para;
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function checkOne(filePath: string, rel: string): Promise<{ rel: string; issues: Issue[] }> {
  const text = await fs.readFile(filePath, "utf-8");
  const m = text.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  if (!m) return { rel, issues: [] };
  const body = stripMdx(m[1]);
  if (body.length < 100) return { rel, issues: [] };

  const chunks = chunkText(body, 3000);
  const all: Issue[] = [];
  for (const chunk of chunks) {
    try {
      const raw = await chat(
        [
          { role: "system", content: SYS_PROMPT },
          { role: "user", content: chunk },
        ],
        { temperature: 0.1, maxTokens: 2000, timeoutMs: 60_000 },
      );
      const jm = raw.match(/\{[\s\S]*\}/);
      if (!jm) continue;
      const obj = JSON.parse(jm[0]) as { issues?: Issue[] };
      if (obj.issues?.length) all.push(...obj.issues);
    } catch (e) {
      console.warn(`  ⚠ chunk 检查失败: ${(e as Error).message.slice(0, 100)}`);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return { rel, issues: all };
}

async function main() {
  const apiKey = process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY;
  if (!apiKey) {
    console.error("[check-typos] 缺 DOUBAO_API_KEY");
    process.exit(1);
  }

  // 收集候选：digest + 原创笔记（zh）
  const targets: Array<{ filePath: string; date: string; rel: string }> = [];
  const cols = SECTION ? [SECTION] : ["ai", "invest"];
  for (const col of cols) {
    const dir = path.join(ROOT, "src", "content", col);
    let files: string[];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".zh.mdx")) continue;
      const fp = path.join(dir, f);
      const stat = await fs.stat(fp);
      const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : stat.mtime.toISOString().slice(0, 10);
      if (SINCE && date < SINCE) continue;
      targets.push({ filePath: fp, date, rel: `${col}/${f}` });
    }
  }
  targets.sort((a, b) => b.date.localeCompare(a.date));
  const sliced = targets.slice(0, LIMIT);

  console.log(`[check-typos] 候选 ${targets.length} 篇 · 本次扫 ${sliced.length} 篇`);
  const allResults: Array<{ rel: string; issues: Issue[] }> = [];
  for (let i = 0; i < sliced.length; i++) {
    const t = sliced[i];
    console.log(`  [${i + 1}/${sliced.length}] ${t.rel}`);
    try {
      const r = await checkOne(t.filePath, t.rel);
      allResults.push(r);
      if (r.issues.length > 0) console.log(`    🔍 ${r.issues.length} 个建议`);
    } catch (e) {
      console.warn(`  ✗ ${(e as Error).message?.slice(0, 200)}`);
    }
  }

  const totalIssues = allResults.reduce((s, r) => s + r.issues.length, 0);
  console.log(`\n[check-typos] 共扫描 ${sliced.length} 篇 · 发现 ${totalIssues} 个建议`);

  // 打印 top 20
  console.log("\n顶部建议：");
  let printed = 0;
  for (const r of allResults) {
    for (const iss of r.issues) {
      if (printed >= 20) break;
      console.log(`  [${iss.type}] ${r.rel}`);
      console.log(`    原文: ${iss.context.slice(0, 80)}`);
      console.log(`    建议: ${iss.suggest.slice(0, 80)}`);
      printed++;
    }
    if (printed >= 20) break;
  }
  if (totalIssues > 20) console.log(`  ... 还有 ${totalIssues - 20} 个`);

  const reportsDir = path.join(ROOT, "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(reportsDir, `typos-${stamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify({
    runAt: new Date().toISOString(),
    scanned: sliced.length,
    totalIssues,
    results: allResults.filter((r) => r.issues.length > 0),
  }, null, 2));
  console.log(`\n📄 报告: ${path.relative(ROOT, reportPath)}`);
}

main().catch((e) => { console.error(e); process.exit(2); });
