/**
 * 把 src/content/{ai,invest,photo,hike}/*.zh.mdx 翻译成对应 .en.mdx。
 *
 * 增量：只翻译 .en.mdx 不存在的 zh 文件。daily-digest cron 跑完后立即处理
 * 新增的 zh 文章（包括人工写的非 digest 文章）。历史回填用：
 *   npx tsx scripts/translate-digest.ts --all
 *
 * 并发：默认 1（避免触发豆包 QPS）；用 --concurrency=N 提高（建议 ≤ 3）。
 *
 * 失败处理：单篇翻译失败跳过（下次重试），不阻塞整个流程。
 * 缺 DOUBAO_API_KEY 直接 return 不报错。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./lib/llm.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORCE_ALL = process.argv.includes("--all");
const COLLECTIONS = ["ai", "invest", "photo", "hike"] as const;
const CONCURRENCY = (() => {
  const m = process.argv.find((a) => a.startsWith("--concurrency="));
  if (!m) return 1;
  const n = parseInt(m.split("=")[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1;
})();
// 一次最多翻多少篇（防止首次回填触发 Actions 90 分钟超时）
const LIMIT = (() => {
  const m = process.argv.find((a) => a.startsWith("--limit="));
  if (!m) return Infinity;
  const n = parseInt(m.split("=")[1], 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

// 术语表（编辑 scripts/translation-glossary.json 即可改）
async function loadGlossary(): Promise<{ preserve: string[]; translations: Record<string, string> }> {
  try {
    const txt = await fs.readFile(path.join(ROOT, "scripts", "translation-glossary.json"), "utf-8");
    const g = JSON.parse(txt) as { preserve_english?: string[]; translations?: Record<string, string> };
    return { preserve: g.preserve_english || [], translations: g.translations || {} };
  } catch {
    return { preserve: [], translations: {} };
  }
}

let SYS_PROMPT = `You are a translator turning Chinese MDX articles into natural, fluent English.

Rules:
1) Preserve ALL markdown syntax exactly: headings (# ##), lists (- *), links [text](url), images ![](), code fences, blockquotes (>), <a> / <FeedbackButtons> JSX tags. Do not change attribute values, URLs, slug strings.
2) In the frontmatter:
   - change \`lang: zh\` to \`lang: en\`
   - keep \`translationKey\` exactly the same
   - translate \`title\` and \`description\` to English (keep date / numeric strings)
   - keep all other frontmatter fields untouched (tags, category, date, draft, cover)
3) Paper titles, person names, technical jargon — keep original English.
4) Output ONLY the translated MDX, no explanations, no markdown fence wrapping the whole thing.`;

async function applyGlossary() {
  const g = await loadGlossary();
  if (g.preserve.length === 0 && Object.keys(g.translations).length === 0) return;
  const parts: string[] = [];
  if (g.preserve.length > 0) {
    parts.push(`Preserve these EXACTLY as English (do not translate): ${g.preserve.join(", ")}.`);
  }
  if (Object.keys(g.translations).length > 0) {
    const pairs = Object.entries(g.translations).slice(0, 30).map(([k, v]) => `"${k}" should stay as "${k}" or translate as "${v}"`).join("; ");
    parts.push(`Translation conventions (中→英 / 英→英): ${pairs}.`);
  }
  if (parts.length > 0) {
    SYS_PROMPT += `\n\nGLOSSARY:\n${parts.join("\n")}`;
  }
}

async function translateOne(srcText: string): Promise<string> {
  // AI digest 单篇 ~12-15KB，翻译产出 token 数会更大（英文比中文 token 多 ~1.5x），
  // maxTokens 必须给足 32K，否则输出被截断导致 sanity check 失败。
  // timeout 也给足 5 min（大文件 + reasoning model 思考耗时长）。
  return chat(
    [
      { role: "system", content: SYS_PROMPT },
      { role: "user", content: srcText },
    ],
    { temperature: 0.2, maxTokens: 32000, timeoutMs: 300_000 },
  );
}

async function findZhToTranslate(): Promise<Array<{ srcPath: string; dstPath: string; rel: string }>> {
  const targets: Array<{ srcPath: string; dstPath: string; rel: string }> = [];
  for (const col of COLLECTIONS) {
    const dir = path.join(ROOT, "src", "content", col);
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".zh.mdx")) continue;
      const dstName = f.replace(/\.zh\.mdx$/, ".en.mdx");
      const srcPath = path.join(dir, f);
      const dstPath = path.join(dir, dstName);
      if (!FORCE_ALL) {
        try {
          await fs.access(dstPath);
          continue; // 已存在 → 跳过
        } catch {
          // 不存在 → 加入
        }
      }
      targets.push({ srcPath, dstPath, rel: `${col}/${f}` });
    }
  }
  // 按修改时间倒序：新文章先翻
  const withStat = await Promise.all(targets.map(async (t) => ({
    ...t, mtime: (await fs.stat(t.srcPath)).mtimeMs,
  })));
  withStat.sort((a, b) => b.mtime - a.mtime);
  const sliced = Number.isFinite(LIMIT) ? withStat.slice(0, LIMIT) : withStat;
  return sliced.map(({ srcPath, dstPath, rel }) => ({ srcPath, dstPath, rel }));
}

async function main() {
  const apiKey = process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY;
  if (!apiKey) {
    console.log("[translate] DOUBAO_API_KEY 未设置，跳过翻译");
    return;
  }
  await applyGlossary();

  const todo = await findZhToTranslate();
  console.log(`[translate] 待翻译 ${todo.length} 篇${FORCE_ALL ? "（强制全量）" : "（增量：仅缺 en 镜像）"} · 并发 ${CONCURRENCY}`);
  if (todo.length === 0) return;

  let ok = 0, failed = 0, done = 0;
  // 简易并发池
  async function worker(i: number) {
    const { srcPath, dstPath, rel } = todo[i];
    const src = await fs.readFile(srcPath, "utf-8");
    // 翻译产出至少要是原文 30%（豆包偶尔输出空或半截）
    const minOut = Math.max(src.length < 500 ? 100 : 200, Math.floor(src.length * 0.3));
    console.log(`  [${++done}/${todo.length}] 翻译 ${rel} (in=${src.length}B)`);
    let lastErr = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const out = await translateOne(src);
        if (!out) throw new Error(`空输出 (尝试${attempt})`);
        if (out.length < minOut) throw new Error(`输出太短 ${out.length}<${minOut} (尝试${attempt})`);
        if (!out.trimStart().startsWith("---")) {
          // 打印前 200 字符方便诊断
          throw new Error(`缺 frontmatter，前 200B: ${out.slice(0, 200).replace(/\n/g, " ")}`);
        }
        // 损坏 JSX 守门：豆包偶尔产出 <FeedbackButtons ... client:visiblevisible}}
        // 这种垃圾，MDX 编译期才报错；这里提前 reject 让重试或跳过
        const damagedMatch = out.match(/<\w[^>]*(?:visiblevisible|client:visible[^/>][^>]{0,40}[}{]{2}|<\w[^>]*\}\})/);
        if (damagedMatch) {
          throw new Error(`损坏 JSX 片段：${damagedMatch[0].slice(0, 80)}`);
        }
        // 兜底：mdx 里出现连续 `}}` 几乎都是 jsx attr 被搞坏（合法 mdx 里很少见连续大括号）
        if (/[^\\\\]\}\}/.test(out) && !/^\s*\{\{/m.test(out)) {
          const m = out.match(/.{0,40}\}\}.{0,20}/);
          throw new Error(`可疑 }} 输出：${m?.[0]?.replace(/\n/g, " ")}`);
        }
        await fs.writeFile(dstPath, out + (out.endsWith("\n") ? "" : "\n"), "utf-8");
        ok++;
        if (attempt > 1) console.log(`    ✓ 重试 #${attempt} 成功，out=${out.length}B`);
        return;
      } catch (e: any) {
        lastErr = e?.message?.slice(0, 300) || String(e);
        if (attempt < 2) {
          console.warn(`    ⚠ ${rel} 尝试 ${attempt} 失败：${lastErr.slice(0, 120)}，重试…`);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
    failed++;
    console.warn(`  ✗ ${rel}: ${lastErr}`);
  }
  let idx = 0;
  async function spawn() {
    while (idx < todo.length) {
      const cur = idx++;
      await worker(cur);
      // 节流 600ms 避豆包 QPS
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => spawn()));
  console.log(`\n[translate] 成功 ${ok} · 失败 ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
