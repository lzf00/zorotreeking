#!/usr/bin/env node
/**
 * 记下「这个周期性审计刚刚跑过」（第 182 轮）
 *
 * 三个周审计（a11y 全站 / 全站巡检 / 移动端跑分）都用「部署后醒一次 + 戳记判定是否到期」，
 * 所以「写戳记 → 提交 → 推送」这段在三个 workflow 里是同一份逻辑。181 轮它写在 a11y.yml
 * 的内联 `node -e` 里，两个坑都踩过：
 *   1) `git diff --quiet` 看不见**未跟踪**的新文件 → 第一次跑永远不提交戳记；
 *   2) 戳记步骤写成 `&& success()` → 审计发现违规就跳过记戳记 → 越有问题越天天重跑。
 * 抽成脚本后，第二点靠「审计真跑过就调用」的 if 条件保证，第一点靠 `git status --porcelain`。
 *
 * 用法：
 *   node scripts/record-audit-stamp.mjs --stamp=src/data/a11y-audit.json --pages=2406 --violations=0
 *   node scripts/record-audit-stamp.mjs --stamp=... --dry-run    # 只写文件，不提交（本地调试）
 *
 * 退出码恒 0：戳记是「记账」，记账失败不该把审计结论变红。推送失败会打 ::warning::。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 戳记内容：只放「什么时候跑过 + 结论规模」，不放敏感信息。 */
export function stampObject({ pages = null, violations = null, sha = null, note = null, now = new Date() } = {}) {
  const stamp = { ranAt: now.toISOString(), pages, violations, sha };
  if (note) stamp.note = note;
  return stamp;
}

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

export function main(argv = process.argv.slice(2)) {
  const valueOf = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const stampArg = valueOf("stamp");
  if (!stampArg) {
    console.error("✗ 需要 --stamp=<文件路径>");
    return 1;
  }
  const stampFile = path.resolve(ROOT, stampArg);
  const rel = path.relative(ROOT, stampFile);
  const number = (name) => {
    const raw = valueOf(name);
    return raw === undefined ? null : Number(raw);
  };

  const stamp = stampObject({
    pages: number("pages"),
    violations: number("violations"),
    sha: (process.env.GITHUB_SHA ?? "").slice(0, 8) || null,
    note: valueOf("note") ?? null,
  });
  if (argv.includes("--dry-run")) {
    // --dry-run 只打印、不落盘：181 轮被 `--dry-run` 覆盖过真实戳记一次（写测试时踩的）
    console.log(`戳记（dry-run，不写盘）：${rel} ← ${JSON.stringify(stamp)}`);
    return 0;
  }
  writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`戳记：${rel} ← ${JSON.stringify(stamp)}`);

  if (process.env.GITHUB_ACTIONS !== "true") {
    console.log("（不在 Actions 里或 --dry-run：只写文件，不提交）");
    return 0;
  }

  try {
    // 关键：`git diff --quiet` 看不见未跟踪文件，必须用 status
    if (!git(["status", "--porcelain", "--", rel]).trim()) {
      console.log("戳记内容没变，跳过提交");
      return 0;
    }
    git(["config", "user.name", "zorotreeking-bot"]);
    git(["config", "user.email", "bot@users.noreply.github.com"]);
    git(["add", "--", rel]);
    git(["commit", "-m", `audit: ${path.basename(rel, ".json")} stamp`]);
    try {
      git(["pull", "--rebase", "--autostash", "origin", "main"]);
    } catch {
      /* rebase 冲突时下面 push 会失败，交给警告 */
    }
    git(["push", "origin", "main"]);
    console.log("戳记已推送");
  } catch (error) {
    console.log(`::warning::戳记推送失败（下次部署会再跑一遍审计，多花时间但不会漏审）：${String(error).split("\n")[0]}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
