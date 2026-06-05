/**
 * 给所有 mdx 内容算 embedding，增量存到 src/data/embeddings.json。
 *
 * 触发：
 *   - prebuild（本地或 deploy.yml build 时不调，没 API key 会跳过）
 *   - daily-digest.yml 拉完新 mdx 后跑一次（commit 时带上更新过的 embeddings.json）
 *
 * 缓存策略：
 *   - 每篇文章按 (title + description + body[0..800]) 的 sha16 当 cache key
 *   - hash 没变 → 复用已存 vector，不调 API
 *   - 新文章 / 改过的文章 → 调豆包 embedding API
 *
 * 输出 JSON 格式（紧凑）：
 *   {
 *     "model": "doubao-embedding-large-text-240915",
 *     "dim": 2048,
 *     "items": {
 *       "ai/digest-2026-06-05": { "hash": "abc123", "vec": [0.001, ...] },
 *       ...
 *     }
 *   }
 *
 * 失败处理：单篇失败跳过（不写入），下次再试；DOUBAO_API_KEY 缺失则直接退出
 * 不报错（让 build 继续跑，related-posts 会 fallback 到 tag overlap）。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embed, contentHash } from "./lib/embedding.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTFILE = path.join(ROOT, "src", "data", "embeddings.json");

interface Cache {
  model: string;
  dim: number;
  items: Record<string, { hash: string; vec: number[] }>;
}

async function readMdxList(): Promise<Array<{ collection: string; key: string; lang: string; text: string }>> {
  const out: Array<{ collection: string; key: string; lang: string; text: string }> = [];
  for (const col of ["ai", "invest", "hike"]) {
    const dir = path.join(ROOT, "src", "content", col);
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".mdx")) continue;
      const full = path.join(dir, f);
      const raw = await fs.readFile(full, "utf-8");

      // 拆 frontmatter / body
      const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!fm) continue;
      const front = fm[1];
      const body = fm[2];

      const lang = /^lang:\s*(\w+)/m.exec(front)?.[1] ?? "zh";
      const key = /^translationKey:\s*"?([^"\n]+)"?/m.exec(front)?.[1];
      if (!key) continue;
      const title = /^title:\s*"?([^"\n]+)"?/m.exec(front)?.[1] ?? "";
      const desc = /^description:\s*"?([^"\n]+)"?/m.exec(front)?.[1] ?? "";

      // 用 title + description + 正文前 800 字符做 embedding 输入
      // 跳过 mdx 语法字符让模型聚焦语义
      const bodyClean = body
        .replace(/^import [^\n]+\n/gm, "")
        .replace(/<FeedbackButtons[^/]+\/>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 800);

      const text = `${title}。${desc}。${bodyClean}`;
      out.push({ collection: col, key, lang, text });
    }
  }
  return out;
}

async function main() {
  const apiKey = process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY;
  if (!apiKey) {
    console.log("[embeddings] DOUBAO_API_KEY 未设置，跳过 embedding 生成（related-posts 会用 tag overlap）");
    return;
  }

  // 读 cache
  let cache: Cache = { model: "doubao-embedding-large-text-240915", dim: 0, items: {} };
  try {
    cache = JSON.parse(await fs.readFile(OUTFILE, "utf-8"));
  } catch {
    console.log("[embeddings] 没找到 cache，从零开始");
  }

  const list = await readMdxList();
  // 只对 zh 算 embedding（en 镜像内容相同，可共用）
  const todo = list.filter((x) => x.lang === "zh");
  console.log(`[embeddings] 扫到 ${todo.length} 篇 zh 文章，开始处理`);

  let hits = 0, misses = 0, failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i];
    const fullKey = `${item.collection}/${item.key}`;
    const h = await contentHash(item.text);

    if (cache.items[fullKey]?.hash === h) {
      hits++;
      continue;
    }

    try {
      const vec = await embed(item.text);
      cache.items[fullKey] = { hash: h, vec };
      cache.dim = vec.length;
      misses++;
      console.log(`  [${i + 1}/${todo.length}] ✓ ${fullKey} (dim=${vec.length})`);
      // 限流 200ms
      await new Promise((r) => setTimeout(r, 200));
    } catch (e: any) {
      failed++;
      console.warn(`  [${i + 1}/${todo.length}] ✗ ${fullKey}: ${e?.message?.slice(0, 100)}`);
    }
  }

  // 删除已经不在 mdx 里的旧条目（清理孤儿）
  const valid = new Set(todo.map((x) => `${x.collection}/${x.key}`));
  let removed = 0;
  for (const k of Object.keys(cache.items)) {
    if (!valid.has(k)) {
      delete cache.items[k];
      removed++;
    }
  }

  await fs.mkdir(path.dirname(OUTFILE), { recursive: true });
  await fs.writeFile(OUTFILE, JSON.stringify(cache));
  const size = (await fs.stat(OUTFILE)).size;
  console.log(`\n[embeddings] 命中 ${hits} · 新建 ${misses} · 失败 ${failed} · 移除孤儿 ${removed}`);
  console.log(`[embeddings] embeddings.json = ${(size / 1024).toFixed(1)} KB · dim=${cache.dim}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
