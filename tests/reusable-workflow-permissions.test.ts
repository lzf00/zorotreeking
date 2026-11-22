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

/** 把若干处 permissions 声明合并成 { scope: 最高等级 }。未声明的 scope 不出现（视为 none）。 */
export function mergePermissions(...blocks: any[]): Record<string, Level> {
  const out: Record<string, Level> = {};
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    for (const [scope, level] of Object.entries<any>(block)) {
      const next = String(level) as Level;
      if (!(scope in out) || (RANK[next] ?? 0) > (RANK[out[scope]] ?? 0)) out[scope] = next;
    }
  }
  return out;
}

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
      const callerPerms = mergePermissions(wf.permissions, job.permissions) as Record<string, Level>;
      // 第 177 轮：原来只取被调用方的**顶层**权限，于是 deploy.yml 的
      // `catch-up-digest` 任务在 job 级加了 `actions: write` 时，这里什么也没看见 ——
      // 11-21 加完、11-21 晚间的 cron 立刻又 startup_failure。
      // GitHub 的规则是「被调用方声明的权限」（顶层 + job 级）都不能超过调用方。
      const calleePerms = mergePermissions(callee.permissions, ...Object.values<any>(callee?.jobs ?? {}).map((j) => j?.permissions)) as Record<string, Level>;
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

test("被调用方 job 级的权限也算数（第 177 轮补的盲点）", () => {
  const callee = { permissions: { contents: "write", statuses: "write" }, jobs: { g: { permissions: { actions: "write" } } } };
  const merged = mergePermissions(
    callee.permissions,
    ...Object.values<any>(callee.jobs).map((job) => job?.permissions),
  );
  assert.deepEqual(merged, { contents: "write", statuses: "write", actions: "write" });

  const caller = { contents: "write", statuses: "write" } as Record<string, Level>;
  const missing = Object.entries(merged).filter(
    ([scope, level]) => (RANK[caller[scope] ?? "none"] ?? 0) < (RANK[level] ?? 0),
  );
  assert.deepEqual(missing.map(([scope]) => scope), ["actions"], "job 级的 actions: write 必须被抓出来");
});

test("三个调用方都显式给了 actions: write 并说明了原因", async () => {
  for (const file of ["daily-digest.yml", "weekly-roundup.yml", "bulk-backfill.yml"]) {
    const text = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    assert.match(text, /^  actions: write$/m, `${file} 缺 actions: write，下一次 cron 还会 startup_failure`);
    assert.match(text, /被调用的 deploy\.yml/, `${file} 没写清为什么要这个权限`);
  }
});
