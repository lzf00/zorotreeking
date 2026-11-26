#!/usr/bin/env node
/**
 * 内容质量体检（第 202 轮）—— **不允许拦发布**的那一类检查。
 *
 * 为什么要单独分出来：第 201 轮查明线上停更两天的原因是"一个每天会变的业务指标卡住了
 * 发布闸门"。同类的风险还有两条，它们检查的是**外部生成的内容**（Wind 生成端产出的英文
 * 日报、日报封面分配），而这些内容不是我写的、也不是每次构建都能保证干净的：
 *
 *   1. 英文日报表格里留着能翻的中文名 —— 生成端副本没同步时会发生；
 *      `deploy.yml` 已经会先跑 `backfill_en_names.py` 回填，剩下的是"表里没有的新名字"。
 *   2. 日报封面被过度复用（>8%）—— 内容每天在长，比例会漂。
 *
 * 这两条放在 `npm test` 里的后果是：生成端一抖，整站就不许发。可发布状态的站点 +
 * 一处内容瑕疵，永远好过"站点冻住"。所以：
 *   - 本地 `npm run gate` 里它是**硬失败**（我发现问题就该先修，不该推）；
 *   - CI 里它是 `continue-on-error: true` 的**告警**（annotation + step summary），
 *     站点照常发布。
 *
 * 用法：
 *   node scripts/check-content-quality.mjs            # 人类可读，有 fail 则退出 1
 *   node scripts/check-content-quality.mjs --json     # 机器可读
 *   node scripts/check-content-quality.mjs --fail-on=warning   # 连 warn 也判失败（本地可选）
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 封面复用的上限：任何一张封面被超过这个比例的日报用到就算挤 */
export const COVER_SHARE_LIMIT = 0.08;
/** 封面池下限：太少说明分配逻辑失效 */
export const COVER_POOL_MIN = 30;

/**
 * 纯函数：从表格行里找出"对照表里认识、但英文版里还留着中文"的单元格。
 * 只认整格等于某个已知中文名（或去掉标记/emoji 之后等于），避免把正常引用误判。
 */
export function leftoverNames(lines, known) {
  const out = [];
  for (const line of lines) {
    if (!line.trimStart().startsWith("|")) continue;
    for (const cell of line.split("|")) {
      const bare = cell
        .replace(/`[^`]*`/g, "")
        .replace(/[🟢🔴⚪🚀💥💰]/gu, "")
        .trim();
      if (known.has(bare)) out.push(bare);
    }
  }
  return out;
}

/** 纯函数：算出封面复用情况 */
export function coverReuse(digests) {
  const counts = new Map();
  for (const { cover } of digests) {
    if (cover) counts.set(cover, (counts.get(cover) ?? 0) + 1);
  }
  const total = digests.length;
  const [worstCover, worstCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return {
    total,
    distinct: counts.size,
    worst: worstCover ? { cover: path.basename(worstCover), count: worstCount, share: total ? worstCount / total : 0 } : null,
  };
}

/** 纯函数：封面复用判定 */
export function judgeCovers(reuse, { shareLimit = COVER_SHARE_LIMIT, poolMin = COVER_POOL_MIN } = {}) {
  if (reuse.total === 0) return { ok: false, detail: "一条日报都没扫到，检查逻辑失效" };
  if (reuse.distinct < poolMin) return { ok: false, detail: `只有 ${reuse.distinct} 张不同封面（下限 ${poolMin}），池子太小` };
  if (!reuse.worst) return { ok: true, detail: `${reuse.total} 篇 / ${reuse.distinct} 张封面` };
  const share = reuse.worst.share;
  const pct = (share * 100).toFixed(1);
  if (share > shareLimit) {
    return { ok: false, detail: `${reuse.worst.cover} 被 ${reuse.worst.count}/${reuse.total} 篇（${pct}%）复用，超过 ${(shareLimit * 100).toFixed(0)}%` };
  }
  return { ok: true, detail: `${reuse.total} 篇 / ${reuse.distinct} 张封面，最挤 ${reuse.worst.cover} ${pct}%` };
}

/** 从 finance_names.py 取"对照表认识的中文名"（以 Python 为准，不在 JS 里复制一份表） */
export function knownChineseNames(root = ROOT) {
  const raw = execFileSync(
    "python3",
    [
      "-c",
      "import sys, json; sys.path.insert(0, 'scripts/wind'); import finance_names as f; print(json.dumps(list({**f.SECTOR_EN, **f.STOCK_EN}.keys())))",
    ],
    { cwd: root, encoding: "utf8" },
  );
  return new Set(JSON.parse(raw));
}

async function readDigests(root) {
  const out = [];
  for (const stream of ["ai", "invest"]) {
    const dir = path.join(root, "src", "content", stream);
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!/^digest-\d{4}-\d{2}-\d{2}\.zh\.mdx$/.test(name)) continue;
      const text = await readFile(path.join(dir, name), "utf8");
      out.push({ file: name, stream, cover: /^cover:\s*"([^"]+)"/m.exec(text)?.[1] });
    }
  }
  return out;
}

/** 缺摘要的期数/条数（信息项：只报数，不判定） */
async function digestDebt(root) {
  const { digestDebtFrom, readDigestBodies } = await import("./sync-known-debt.mjs");
  return digestDebtFrom(await readDigestBodies(root));
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const failOn = args.find((a) => a.startsWith("--fail-on="))?.slice("--fail-on=".length) ?? "error";
  const root = args.find((a) => a.startsWith("--root="))?.slice("--root=".length) ?? ROOT;
  const results = [];

  // 1. 英文日报表格里的中文残留
  try {
    const known = knownChineseNames(root);
    const dir = path.join(root, "src", "content", "invest");
    const files = (await readdir(dir)).filter((f) => /^market-recap-.*\.en\.mdx$/.test(f));
    const leftovers = [];
    for (const file of files) {
      const lines = (await readFile(path.join(dir, file), "utf8")).split("\n");
      for (const name of leftoverNames(lines, known)) leftovers.push(`${file}: ${name}`);
    }
    results.push({
      id: "en-recap-chinese",
      label: "英文日报表格里的中文名",
      level: leftovers.length ? "fail" : "ok",
      detail: leftovers.length
        // 每天服务器上的生成端副本都会再写进中文名，所以这里直接给"一条命令修干净"，
        // 而不是让人去翻部署脚本才知道怎么修（第 218 轮）。
        ? `${leftovers.length} 处（例：${leftovers.slice(0, 3).join("；")}）—— 改法：npm run fix:recap-names`
        : `${files.length} 个英文日报干净`,
    });
  } catch (error) {
    results.push({
      id: "en-recap-chinese",
      label: "英文日报表格里的中文名",
      level: "warn",
      detail: `检查没跑成（${String(error?.message ?? error).slice(0, 120)}），本轮跳过`,
    });
  }

  // 2. 封面复用
  try {
    const digests = await readDigests(root);
    const verdict = judgeCovers(coverReuse(digests));
    results.push({
      id: "digest-cover-reuse",
      label: "日报封面复用比例",
      level: verdict.ok ? "ok" : "fail",
      detail: verdict.detail,
    });
  } catch (error) {
    results.push({ id: "digest-cover-reuse", label: "日报封面复用比例", level: "warn", detail: `检查没跑成：${String(error?.message ?? error).slice(0, 120)}` });
  }

  // 3. 缺摘要（信息项，永不判失败；数字由 sync-known-debt 维护）
  try {
    const debt = await digestDebt(root);
    results.push({
      id: "digest-missing-summaries",
      label: "日报缺摘要（信息）",
      level: "ok",
      detail: `${debt.periods} 期 / ${debt.items} 条（整期全空 ${debt.wholeEmpty} 期，部分缺 ${debt.partial} 期）`,
    });
  } catch (error) {
    results.push({ id: "digest-missing-summaries", label: "日报缺摘要（信息）", level: "warn", detail: `统计失败：${String(error?.message ?? error).slice(0, 120)}` });
  }

  const failures = results.filter((r) => r.level === "fail");
  const warnings = results.filter((r) => r.level === "warn");

  if (json) {
    process.stdout.write(`${JSON.stringify({ results, failures: failures.length, warnings: warnings.length }, null, 2)}\n`);
  } else {
    for (const r of results) {
      const mark = r.level === "ok" ? "✓" : r.level === "warn" ? "⚠" : "✗";
      console.log(`${mark} ${r.label}：${r.detail}`);
    }
    console.log(failures.length ? `\n内容质量：${failures.length} 项不合格（不拦发布，但要在下一轮修）` : "\n内容质量：全部通过");
  }

  // CI 里这一步是 continue-on-error，所以这里用注解当"说话"的方式
  for (const r of failures) console.log(`::warning title=内容质量·${r.label}::${r.detail}`);
  if (failOn === "warning" && warnings.length) return 1;
  return failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
