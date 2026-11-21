/**
 * 被调用的 reusable workflow 不能要求比调用方更多的权限（第 107 轮）。
 *
 * 这不是理论风险，是一次**真实的三天停更**：11-18 到 11-20 日报一篇没出，
 * 每次定时运行都是 1 秒钟的 `startup_failure`，没有任何日志。
 *
 * 根因（本轮用当时的提交复现出来的）：
 *
 * | 位置 | 当时的声明 |
 * |---|---|
 * | `deploy.yml`（被调用方） | `permissions: { contents: read, statuses: write }` |
 * | `daily-digest.yml`（调用方） | `permissions: { contents: write }` ← 没有 `statuses` |
 *
 * GitHub 规定：reusable workflow 的权限 **不得超过调用方**。于是整条运行在解析阶段就被拒，
 * 一个 job 都不会启动 —— 所以 run 的 `created_at` 和 `updated_at` 只差 1 秒，日志是空的。
 * 这类故障既不红也不报错，只能靠静态检查提前发现。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const DIR = new URL("../.github/workflows/", import.meta.url);
const FILES = (await readdir(DIR)).filter((f) => f.endsWith(".yml"));

type Level = "none" | "read" | "write";
const RANK: Record<string, number> = { none: 0, read: 1, write: 2 };

/** 收集所有「调用本仓库 reusable workflow」的 job，并校验权限包含关系。 */
async function audit(): Promise<{ caller: string; callee: string; problems: string[] }[]> {
  const parsed = new Map<string, any>();
  for (const file of FILES) {
    parsed.set(file, parse(await readFile(new URL(file, DIR), "utf8")));
  }
  const rows: { caller: string; callee: string; problems: string[] }[] = [];
  for (const [file, wf] of parsed) {
    for (const [jobName, job] of Object.entries<any>(wf?.jobs ?? {})) {
      const uses = job?.uses;
      if (typeof uses !== "string" || !uses.startsWith("./.github/workflows/")) continue;
      const calleeName = path.basename(uses);
      const callee = parsed.get(calleeName);
      assert.ok(callee, `${file} 的 job ${jobName} 调用了不存在的 ${uses}`);
      const callerPerms = (job.permissions ?? wf.permissions ?? {}) as Record<string, Level>;
      const calleePerms = (callee.permissions ?? {}) as Record<string, Level>;
      const problems: string[] = [];
      for (const [scope, level] of Object.entries(calleePerms)) {
        const callerLevel = callerPerms[scope] ?? "none";
        if ((RANK[callerLevel] ?? 0) < (RANK[level] ?? 0)) {
          problems.push(
            `${scope}: 调用方是 ${callerLevel}，被调用方要 ${level} —— 运行会在启动阶段就失败`,
          );
        }
      }
      rows.push({ caller: `${file}::${jobName}`, callee: calleeName, problems });
    }
  }
  return rows;
}

test("每个 reusable workflow 调用方的权限都覆盖被调用方（这是 11-18 停更三天的根因）", async () => {
  const rows = await audit();
  assert.ok(rows.length >= 3, `只找到 ${rows.length} 处 reusable 调用，扫描逻辑可能失效`);
  const broken = rows.filter((r) => r.problems.length > 0);
  assert.deepEqual(
    broken.map((r) => `${r.caller} → ${r.callee}: ${r.problems.join("; ")}`),
    [],
    "有调用方的权限不覆盖被调用方，推上去就会 startup_failure",
  );
});

test("回归守卫本身能抓住 11-20 那版配置", async () => {
  // 用当时真实的两份声明复算一遍，确认检查逻辑不是"永远绿"
  const caller = { contents: "write" } as Record<string, Level>;
  const callee = { contents: "read", statuses: "write" } as Record<string, Level>;
  const missing = Object.entries(callee).filter(
    ([scope, level]) => (RANK[caller[scope] ?? "none"] ?? 0) < (RANK[level] ?? 0),
  );
  assert.deepEqual(missing.map(([scope]) => scope), ["statuses"], "检查逻辑没能识别出缺失的 statuses");
});
