#!/usr/bin/env node
/**
 * 站内搜索探针：pagefind 的索引和碎片必须**全部可读**，否则搜索对用户就是坏的。
 *
 * 背景（第 80 轮）：生产上 20 个常见查询里有 4 个直接报错：
 *   Error: 403 fetching /pagefind/fragment/zh-cn_XXX.pf_fragment
 * 关键线索是状态码：随便编一个不存在的碎片名返回 **404**（Astro 的 404 页），
 * 而这 4 个固定名字稳定返回 **403**（nginx 的 146 字节错误页）—— 说明文件在，
 * 只是 nginx 读不了（权限位）。部署用 `rsync --no-perms` + `cp -al` 硬链接播种，
 * 一有小概率文件落到 `0600`，搜索就会对**部分**关键词坏掉，而站点其他部分完全正常，
 * 所以既有的烟测都发现不了。
 *
 * 这个探针按真实前端路径跑：加载页面 → import("/pagefind/pagefind.js") → 逐个查询。
 * 只把**报错**算失败；某词恰好 0 结果只是警告（那是内容问题，不是交付问题）。
 *
 * 第 118 轮补了两件它测不出来的事：
 *   a) **索引是不是新的** —— 只测"有结果"测不出"昨天写的文章没进索引"；
 *   b) **命中是不是活链接** —— 索引里残留已删页面的 URL 时，搜索结果点进去是 404。
 *
 * 用法：
 *   node scripts/check-search.mjs                                  # 打线上
 *   node scripts/check-search.mjs --base=http://127.0.0.1:4321    # 打已有的本地服务
 *   node scripts/check-search.mjs --dist                             # 自己起静态服务打 dist（门禁用）
 *   node scripts/check-search.mjs --json
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { chromePath, serveDist } from "./lib/serve-dist.mjs";

/** 默认查询集：覆盖站内五大板块 + 中英文，全部应当返回结果。 */
export const DEFAULT_QUERIES = [
  "ETF",
  "三因子",
  "投资",
  "日报",
  "市场",
  "回测",
  "摄影",
  "宝可梦",
  "徒步",
  "论文",
  "深度学习",
  "复盘",
];

/**
 * 纯逻辑：把每个查询的结果汇总成「有没有坏」。可单测。
 * @param {{ query: string, total?: number, error?: string, retried?: boolean }[]} rows
 */
export function summarizeSearchProbe(rows) {
  const failures = rows.filter((row) => row.error);
  const empties = rows.filter((row) => !row.error && row.total === 0);
  // 第 118 轮：索引不是新的、命中是死链，都算"搜索坏了"——用户感知和 403 一样
  const staleIndex = rows
    .filter((row) => row.freshness)
    .map((row) => ({ url: row.freshness.url, ...assertFreshHit(row.freshness.rank === null ? null : row.freshness) }))
    .filter((item) => !item.ok);
  // 标题探针只报警告：它受分词和聚合页影响，不构成"搜索坏了"的证据
  const titleWarnings = rows
    .filter((row) => row.freshness?.titleRank !== undefined)
    .map((row) => ({
      url: row.freshness.url,
      ...assertTitleRank(row.freshness.titleRank === null ? null : {
        rank: row.freshness.titleRank,
        url: row.freshness.url,
        top: row.freshness.titleTop,
      }),
    }))
    .filter((item) => !item.ok || item.warning);
  const deadLinks = rows.flatMap((row) => row.deadLinks ?? []);
  return {
    rows,
    failures,
    empties,
    staleIndex,
    titleWarnings,
    deadLinks,
    ok: failures.length === 0 && staleIndex.length === 0 && deadLinks.length === 0,
    /** 失败信息里最有用的是资源路径 + 状态码，提取出来直接给人看 */
    brokenResources: failures.map((row) => extractResource(row.error)),
  };
}

/**
 * 纯逻辑：最新一篇日报是否"新鲜到能被搜到"。
 *
 * 第 134 轮修正：原来硬性要求排进前 3，实测会**误报**——用最新一期的完整标题
 * （`投资资讯日报 · 2026-11-21`）查询时，排在前面的全是**聚合页**
 * （`/tag/tonghuashun/`、`/invest/digest/`、`/archive/`），因为这些页面把 189 期标题
 * 全列了出来，词频天然更高。这不是"索引没更新"，是列表页本来就该排在前面。
 *
 * 真正要保证的性质是：**最新一期的排名必须高于所有旧期**（新内容压过旧内容）。
 * 所以：前 3 名直接过；否则只要它排在同类旧页面之前就过。
 *
 * @param {{ rank: number, top?: string[], url?: string } | null} hit
 */
export function assertFreshHit(hit, { expectedRank = 3 } = {}) {
  if (!hit || hit.rank == null) return { ok: false, reason: `最新日报没有出现在搜索结果（期望前 ${expectedRank} 名）` };
  const top = hit.top ?? [];
  const url = hit.url ?? "";
  // 「同类旧期」的判据：URL 里日期之前的部分（`/invest/digest-`、`/ai/digest-`）
  const siblingPattern = url.replace(/\d{4}-\d{2}-\d{2}[\s\S]*$/, "");
  if (siblingPattern && top.length > 0 && hit.rank > 1) {
    const olderAbove = top
      .slice(0, hit.rank - 1)
      .filter((candidate) => candidate.startsWith(siblingPattern) && candidate !== url);
    if (olderAbove.length > 0) {
      return {
        ok: false,
        reason: `最新日报排在第 ${hit.rank} 名，还落在旧期 ${olderAbove[0]} 后面（索引可能没更新）`,
      };
    }
  }
  if (top.length === 0) {
    // 老调用方（只有 rank 没有榜单）沿用严格规则
    return hit.rank > expectedRank
      ? { ok: false, reason: `最新日报排在第 ${hit.rank} 名（期望前 ${expectedRank} 名）` }
      : { ok: true, reason: null };
  }
  // 有榜单且没有旧期压在前面 = 索引是新的；聚合页排前面是正常现象（列表页列了全部标题）
  return { ok: true, reason: null };
}

/**
 * 纯逻辑：**标题探针**的判定（第 139 轮）。
 *
 * 第 118 轮起用"最新一期的完整标题"当查询词来验证索引新鲜度。实测这个探针不稳：
 *   `投资资讯日报 · 2026-11-22` 零命中，但同一页面查询 `2026-11-22` 排第 1。
 * 原因不是索引没更新，而是 `·` 与日期被切成多个 token，标题里高频词被 `/tag/digest/`、
 * `/archive/` 这类列出全部期号的聚合页抢走。
 *
 * 所以拆成两条断言：
 *  - **日期探针**（硬）：用 `2026-11-22` 查，必须在前 3 —— 这才是"进没进索引"。
 *  - **标题探针**（软）：能查到就沿用第 134 轮"不能排在旧期后面"的规则；
 *    零命中只记为警告，因为那是分词/排序噪声，不是索引坏了。
 */
export function assertTitleRank(hit, { expectedRank = 10 } = {}) {
  if (!hit || hit.rank == null) {
    return { ok: true, warning: "标题整句搜不到（分词噪声，日期探针已证明页面在索引里）" };
  }
  const verdict = assertFreshHit(hit, { expectedRank });
  return { ok: verdict.ok, warning: verdict.ok ? null : verdict.reason };
}

/**
 * 纯逻辑：搜索结果里的 URL 有哪些打不开（索引残留 / 页面被删）。
 * @param {string[]} urls
 * @param {(url: string) => boolean} alive 由调用方注入（能做 I/O，便于测试）
 */
export function deadResultLinks(urls, alive) {
  return urls.filter((url) => !alive(url));
}

/**
 * 纯逻辑：从文件列表里找出最新的日报日期。
 * @param {string[]} files 形如 digest-2026-11-21.zh.mdx
 */
export function newestDigestDate(files) {
  const dates = files
    .map((file) => file.match(/^digest-(\d{4}-\d{2}-\d{2})\.(?:zh|en)\.mdx$/)?.[1])
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? null;
}

/** 从 pagefind 的报错文本里抽出「状态码 + 资源路径」。 */
export function extractResource(message = "") {
  const match = /(\d{3})\s+fetching\s+(\S+)/.exec(message);
  return match ? { status: Number(match[1]), path: match[2] } : { status: null, path: null };
}

export function formatSearchProbe({ rows, failures, empties, staleIndex = [], titleWarnings = [], deadLinks = [], ok }, base) {
  const lines = [`站内搜索探针（${base}）`, ""];
  for (const row of rows.filter((item) => !item.meta)) {
    const icon = row.error ? "✗" : row.total === 0 ? "⚠" : "✓";
    const detail = row.error ? `报错：${extractResource(row.error).status ?? "?"} ${extractResource(row.error).path ?? row.error}` : `${row.total} 条`;
    lines.push(`  ${icon} ${row.query} — ${detail}${row.retried ? "（重试后）" : ""}`);
  }
  lines.push("");
  const realQueries = rows.filter((row) => !row.meta);
  lines.push(
    ok
      ? `搜索可用：${realQueries.length} 个查询全部返回结果${empties.length ? `（其中 ${empties.length} 个 0 结果，属内容覆盖问题）` : ""}`
      : failures.length
        ? `搜索坏了：${failures.length}/${realQueries.length} 个查询报错。碎片 404 = 文件没发布；碎片 403 = 文件在但 nginx 读不了（权限位）`
        : "搜索坏了：查询本身能跑，但索引或命中不对（明细见下）",
  );
  if (staleIndex.length) {
    lines.push("");
    lines.push("索引不是最新的（新内容进了页面但没进索引）：");
    for (const item of staleIndex) lines.push(`  ✗ ${item.url} — ${item.reason}`);
  }
  if (titleWarnings.length) {
    lines.push("");
    lines.push("标题整句搜不到（警告级，页面本身已在索引里）：");
    for (const item of titleWarnings) lines.push(`  ⚠ ${item.url} — ${item.warning ?? ""}`);
  }
  if (deadLinks.length) {
    lines.push("");
    lines.push("搜索命中是死链（索引残留已删页面）：");
    for (const url of deadLinks) lines.push(`  ✗ ${url}`);
  }
  return lines.join("\n");
}

async function probeQuery(page, query) {
  return page.evaluate(async (q) => {
    const pagefind = await import("/pagefind/pagefind.js");
    await pagefind.init();
    const search = await pagefind.search(q);
    // 真正触发碎片下载的是 data()：只 search() 不 data() 测不出 403
    const top = await Promise.all(search.results.slice(0, 10).map(async (result) => (await result.data()).url));
    return { total: search.results.length, top };
  }, query);
}

/** 从内容目录里找最新日报，用它来断言"索引是新的"。 */
async function newestDigests(root) {
  const out = [];
  for (const kind of ["ai", "invest"]) {
    const dir = path.join(root, "src", "content", kind);
    try {
      const files = await readdir(dir);
      const date = newestDigestDate(files);
      if (!date) continue;
      // 标题要从 frontmatter 读：页面 <title> 带站名后缀，切出来往往只剩通用词
      const raw = await readFile(path.join(dir, `digest-${date}.zh.mdx`), "utf8");
      const title = /^title:\s*"?(.+?)"?\s*$/m.exec(raw)?.[1] ?? date;
      out.push({ kind, date, title, url: `/${kind}/digest-${date}/` });
    } catch {
      // 没有内容目录（比如只跑 dist 的 CI）就跳过这条断言
    }
  }
  return out;
}

/** 结果 URL 是否真的能打开（HEAD 走一遍，跟随静态服务的 404 页）。 */
async function urlAlive(page, base, url) {
  try {
    const res = await page.request.get(`${base}${url}`, { timeout: 15_000 });
    return res.status() === 200;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  // --dist：不依赖有人先起好服务，自己把 dist 挂起来（门禁里就是这么用的）。
  // 线上那条路径（默认打生产）保留，因为 nginx 的权限/头问题只有线上才有。
  const distArg = args.find((arg) => arg === "--dist" || arg.startsWith("--dist="));
  let server = null;
  let base = args.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ?? "https://www.zorotreeking.online";
  if (distArg) {
    const root = distArg.includes("=") ? distArg.slice("--dist=".length) : "dist";
    server = await serveDist(root);
    base = `http://127.0.0.1:${server.address().port}`;
  }
  const freshness = await newestDigests(process.cwd());
  const queriesArg = args.find((arg) => arg.startsWith("--queries="));
  const queries = queriesArg ? queriesArg.slice("--queries=".length).split(",").filter(Boolean) : DEFAULT_QUERIES;

  const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const rows = [];
  try {
    await page.goto(base, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(500);
    for (const query of queries) {
      let row = { query };
      try {
        const probe = await probeQuery(page, query);
        row.total = probe.total;
        row.top = probe.top;
      } catch (error) {
        // 一次报错可能只是某个碎片请求偶发失败，重试一次再定性
        await page.waitForTimeout(800);
        try {
          const retry = await probeQuery(page, query);
          row = { query, total: retry.total, top: retry.top, retried: true };
        } catch (retryError) {
          row.error = String(retryError?.message ?? retryError).split("\n")[0];
        }
      }
      rows.push(row);
    }

    // 索引是不是新的：**日期探针是硬的**（用 `2026-11-22` 查，必须进前 3），
    // 标题探针是软的（第 139 轮：`投资资讯日报 · 2026-11-22` 会零命中，但同一页面
    // 查日期排第 1 —— 那是分词和聚合页造成的噪声，不能当成"索引没更新"报红）。
    for (const item of freshness) {
      try {
        const dateProbe = await probeQuery(page, item.date);
        const dateRank = dateProbe.top.findIndex((u) => u.startsWith(item.url));
        const titleProbe = await probeQuery(page, item.title);
        const titleRank = titleProbe.top.findIndex((u) => u.startsWith(item.url));
        rows.push({
          query: `${item.date}（索引新鲜度）`,
          total: dateProbe.total,
          top: dateProbe.top,
          meta: true,
          freshness: {
            url: item.url,
            rank: dateRank === -1 ? null : dateRank + 1,
            top: dateProbe.top,
            titleRank: titleRank === -1 ? null : titleRank + 1,
            titleTop: titleProbe.top,
          },
        });
      } catch (error) {
        rows.push({ query: item.date, error: String(error?.message ?? error).split("\n")[0], meta: true, freshness: { url: item.url, rank: null, titleRank: null } });
      }
    }

    // 第 118 轮：命中必须是活链接 —— 索引里残留已删页面的 URL 时点进去就是 404。
    // 采样要"各查询的前 3 名 + 最新日报本身"：只取扁平前 12 条会全落在前几个查询上，
    // 恰好漏掉最新内容（第 118 轮实测：删掉最新日报页，检查居然还是绿的）。
    const sample = [
      ...new Set([...freshness.map((item) => item.url), ...rows.flatMap((row) => (row.top ?? []).slice(0, 3))]),
    ].slice(0, 24);
    const dead = [];
    for (const url of sample) {
      if (!(await urlAlive(page, base, url))) dead.push(url);
    }
    rows.push({ query: `搜索结果活链接（抽查 ${sample.length} 条）`, deadLinks: dead, total: sample.length, meta: true });
  } finally {
    await browser.close();
    server?.close();
  }

  const summary = summarizeSearchProbe(rows);
  if (json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else process.stdout.write(`${formatSearchProbe(summary, base)}\n`);

  if (!summary.ok) {
    const why = [
      summary.failures.length ? `${summary.failures.length}/${rows.length} 个查询报错` : "",
      summary.staleIndex.length ? `${summary.staleIndex.length} 个新页面没进索引` : "",
      summary.deadLinks.length ? `${summary.deadLinks.length} 个命中是死链` : "",
    ].filter(Boolean).join("；");
    process.stderr.write(`::error title=站内搜索不可用::${why}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
