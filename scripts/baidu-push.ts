/**
 * Deploy 完后把最新文章 URL 主动推给百度普通收录 API。
 *
 * 为什么需要：百度不支持 IndexNow，爬 sitemap 又很懒（新站尤其），
 * 主动推送是百度收录提速的官方正道。
 *
 * 策略（CI 无状态友好）：
 *   - CI 每次全新 checkout：mtime 全是 checkout 时间、state 文件不持久 —— 都不可靠
 *   - 改读 mdx frontmatter 的 date 字段，按日期新→旧推最新 N 条
 *   - 每次 deploy 重复推同一批也无妨：百度对重复提交不处罚，
 *     而站点每天有自动内容（digest/recap），实际推的基本都是当天新文
 *
 * 配置：环境变量 BAIDU_PUSH_TOKEN（GitHub Secrets）。
 *   未配置时打印提示直接退出（不报错，不阻塞 deploy）。
 *
 * 配额：普通收录每日限额（新站约 10 条/天），MAX_PER_RUN=10。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.zorotreeking.online";
const MAX_PER_RUN = 10;

const TOKEN = process.env.BAIDU_PUSH_TOKEN || "";

async function collectZhUrlsByDate(): Promise<{ url: string; date: string }[]> {
  const out: { url: string; date: string }[] = [];
  for (const col of ["ai", "invest", "hike", "photo"]) {
    const dir = path.join(ROOT, "src", "content", col);
    let files: string[] = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".zh.mdx")) continue; // 百度只推中文页
      const slug = f.replace(/\.zh\.mdx$/, "");
      let date = "1970-01-01";
      try {
        const head = (await fs.readFile(path.join(dir, f), "utf-8")).slice(0, 800);
        const m = head.match(/^date:\s*["']?(\d{4}-\d{2}-\d{2})/m);
        if (m) date = m[1];
      } catch {}
      out.push({ url: `${SITE}/${col}/${slug}`, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function main() {
  if (!TOKEN) {
    console.log("[baidu-push] BAIDU_PUSH_TOKEN 未配置，跳过（配置后自动生效）");
    return;
  }

  const latest = (await collectZhUrlsByDate()).slice(0, MAX_PER_RUN);
  if (latest.length === 0) {
    console.log("[baidu-push] 没有可推的 URL");
    return;
  }

  const body = latest.map((x) => x.url).join("\n");
  const api = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(SITE)}&token=${TOKEN}`;
  try {
    const r = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });
    const resp = await r.json().catch(() => ({}));
    // 成功 {"success":N,"remain":M}；错误 {"error":401,"message":"token is not valid"}
    console.log(`[baidu-push] 推送 ${latest.length} 条（最新日期 ${latest[0].date}）→`, JSON.stringify(resp));
  } catch (e: any) {
    console.log(`[baidu-push] 请求失败（不阻塞 deploy）: ${e?.message || e}`);
  }
}

main();
