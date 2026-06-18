/**
 * Deploy 完后调用 IndexNow 主动通知 Bing / Yandex / Naver 新内容。
 *
 * 工作机制：
 *   - 收集所有 mdx 文章的 url + lastmod
 *   - 跟上一份 .indexnow-state.json 对比，找出新增 / 改动的
 *   - POST 给 https://api.indexnow.org/IndexNow
 *
 * 验证：search engine 会 GET https://www.zorotreeking.online/<KEY>.txt
 * 比对内容是否等于 KEY；那个文件已经在 public/。
 *
 * 失败不阻塞：网络挂 / 限流都吞，下次 deploy 会补推。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "c7e8f83ddbcff7d71adace9ed2a65fb9";
const SITE = "https://www.zorotreeking.online";
const STATE_FILE = path.join(ROOT, ".indexnow-state.json");

async function collectMdxUrls(): Promise<{ url: string; mtime: number }[]> {
  const out: { url: string; mtime: number }[] = [];
  for (const col of ["ai", "invest", "hike", "photo"]) {
    const dir = path.join(ROOT, "src", "content", col);
    let files: string[] = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".mdx")) continue;
      const m = f.match(/^(.+?)\.(zh|en)\.mdx$/);
      if (!m) continue;
      const [, key, lang] = m;
      const prefix = lang === "en" ? `${SITE}/en/${col}` : `${SITE}/${col}`;
      const st = await fs.stat(path.join(dir, f));
      out.push({ url: `${prefix}/${key}/`, mtime: st.mtimeMs });
    }
  }
  // 加上静态页
  for (const p of ["", "/about", "/uses", "/subscribe", "/contact", "/ai", "/invest", "/photo", "/hike",
                    "/ai/digest", "/invest/digest"]) {
    out.push({ url: `${SITE}${p}`, mtime: Date.now() });
  }
  return out;
}

async function main() {
  const current = await collectMdxUrls();
  const curMap = Object.fromEntries(current.map((x) => [x.url, x.mtime]));

  let prev: Record<string, number> = {};
  try { prev = JSON.parse(await fs.readFile(STATE_FILE, "utf-8")); } catch {}

  // 新增 / 改动的 URL
  const changed = current.filter((x) => {
    const last = prev[x.url];
    return last === undefined || x.mtime > last + 1000; // 1s 容差
  }).map((x) => x.url);

  if (changed.length === 0) {
    console.log("[indexnow] 没有新增/改动 URL，跳过");
    return;
  }

  console.log(`[indexnow] 推送 ${changed.length} 个 URL 给 IndexNow ...`);
  const body = {
    host: new URL(SITE).host,
    key: KEY,
    keyLocation: `${SITE}/${KEY}.txt`,
    urlList: changed.slice(0, 10000),  // IndexNow 单批上限 10k
  };

  try {
    const r = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    console.log(`[indexnow] HTTP ${r.status}`);
    if (r.status === 200 || r.status === 202) {
      console.log(`[indexnow] ✓ 推送成功，${changed.length} 个 URL`);
    } else {
      const t = await r.text();
      console.warn(`[indexnow] ⚠️ 失败：${t.slice(0, 200)}`);
    }
  } catch (e: any) {
    console.warn(`[indexnow] ⚠️ 网络异常：${e?.message ?? e}`);
  }

  // 不管成败都更新 state（避免反复推同一批）
  await fs.writeFile(STATE_FILE, JSON.stringify(curMap, null, 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
