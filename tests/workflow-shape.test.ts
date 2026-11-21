/**
 * 工作流的「结构合法性」静态校验（第 98 轮）。
 *
 * 起因：2026-11-19 的 `startup_failure` —— 工作流根本没跑起来，没有日志、没有注解，
 * 只有「产出没了」。GitHub 只在**触发时**才校验 YAML，而校验失败的反馈几乎为零。
 * 所以把能静态查的部分都搬到门禁里：
 *
 *   1. 每个 .yml 都能被解析，且有 name / on / jobs 的骨架；
 *   2. 权限名拼错、值写了 true/false（必须是 read/write/none）→ 静态就能抓；
 *   3. `uses: ./...` 指向的文件必须存在；
 *   4. `workflow_run.workflows` 里写的名字必须是**真实存在的 workflow name** ——
 *      名字打错不会报错，只会永远不触发（这条最阴，第 96 轮新加的看门狗就靠它）；
 *   5. cron 必须是 5 段、范围合法。
 *
 * 这里不重复 workflows.test.ts 的语义断言（那些是关于「内容」的）。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const DIR = new URL("../.github/workflows/", import.meta.url);
const files = (await readdir(DIR)).filter((f) => f.endsWith(".yml")).sort();
const docs = new Map<string, any>();
for (const file of files) docs.set(file, parse(await readFile(new URL(file, DIR), "utf8")));

const PERMISSION_SCOPES = new Set([
  "actions", "attestations", "checks", "contents", "deployments", "discussions",
  "id-token", "issues", "models", "packages", "pages", "pull-requests",
  "repository-projects", "security-events", "statuses",
]);

test("每个工作流都有 name / on / jobs，且 job 结构完整", () => {
  assert.ok(files.length >= 10, `工作流数量异常：${files.length}`);
  for (const [file, doc] of docs) {
    assert.ok(doc?.name, `${file} 缺 name`);
    assert.ok(doc?.on, `${file} 缺 on`);
    assert.ok(doc?.jobs && Object.keys(doc.jobs).length > 0, `${file} 没有 jobs`);
    for (const [id, job] of Object.entries<any>(doc.jobs)) {
      if (job.uses) {
        // 复用工作流调用：没有 runs-on / steps，但必须有 secrets 或显式声明不需要
        assert.match(String(job.uses), /^\.\/\.github\/workflows\/.+\.yml$/, `${file} / ${id} 的 uses 不是本仓库工作流：${job.uses}`);
        continue;
      }
      assert.ok(job["runs-on"], `${file} 的 job ${id} 缺 runs-on`);
      assert.ok(Array.isArray(job.steps) && job.steps.length > 0, `${file} 的 job ${id} 没有 steps`);
      for (const step of job.steps) {
        assert.ok(step.run || step.uses, `${file} / ${id} 有既没有 run 也没有 uses 的步骤`);
        assert.ok(!(step.run && step.uses), `${file} / ${id} 同时写了 run 和 uses`);
      }
    }
  }
});

test("权限只写允许的 scope，值只能是 read / write / none", () => {
  for (const [file, doc] of docs) {
    const perms = doc.permissions;
    if (perms === undefined) continue;
    if (perms === "read-all" || perms === "write-all") continue;
    assert.equal(typeof perms, "object", `${file} 的 permissions 形状不对`);
    for (const [scope, value] of Object.entries(perms)) {
      assert.ok(PERMISSION_SCOPES.has(scope), `${file} 的权限 scope 不存在：${scope}`);
      assert.ok(["read", "write", "none"].includes(String(value)), `${file} 的 ${scope} 取值非法：${value}`);
    }
  }
});

test("`uses: ./…` 指向的文件必须真的存在（拼错会 startup_failure）", async () => {
  for (const [file, doc] of docs) {
    for (const [id, job] of Object.entries<any>(doc.jobs)) {
      const refs: string[] = [];
      if (typeof job.uses === "string") refs.push(job.uses);
      for (const step of job.steps ?? []) if (typeof step.uses === "string") refs.push(step.uses);
      for (const ref of refs.filter((r) => r.startsWith("./"))) {
        const target = new URL(`../../${ref.slice(2)}`, DIR);
        await assert.doesNotReject(readFile(target), `${file} / ${id} 引用了不存在的 ${ref}`);
      }
    }
  }
});

test("workflow_run 里写的 workflow 名字必须真实存在（打错不会报错，只会永不触发）", () => {
  const names = new Set([...docs.values()].map((doc) => doc.name));
  let checked = 0;
  for (const [file, doc] of docs) {
    const triggers = Array.isArray(doc.on) ? doc.on : [doc.on].filter(Boolean);
    for (const trigger of triggers) {
      const watched = trigger?.workflow_run?.workflows;
      if (!watched) continue;
      for (const name of [watched].flat()) {
        checked += 1;
        assert.ok(names.has(name), `${file} 监听的 workflow「${name}」不存在（现有：${[...names].join(" / ")}）`);
      }
    }
  }
  assert.ok(checked >= 2, `应该有至少两处 workflow_run 监听，实际检查到 ${checked}`);
});

test("cron 表达式是 5 段且在合法范围内", () => {
  const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  let checked = 0;
  for (const [file, doc] of docs) {
    const triggers = Array.isArray(doc.on) ? doc.on : [doc.on].filter(Boolean);
    for (const trigger of triggers) {
      for (const entry of trigger?.schedule ?? []) {
        const parts = String(entry.cron).trim().split(/\s+/);
        assert.equal(parts.length, 5, `${file} 的 cron 不是 5 段：${entry.cron}`);
        parts.forEach((part: string, i: number) => {
          const [min, max] = limits[i];
          assert.match(part, /^[\d*\/,\-]+$/, `${file} 的 cron 字段不合法：${part}`);
          const nums = part.split(/[,\-]/).filter((n) => /^\d+$/.test(n)).map(Number);
          for (const n of nums) assert.ok(n >= min && n <= max, `${file} 的 cron 字段越界：${part}`);
        });
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 5, `cron 覆盖不足：只检查到 ${checked} 条`);
});
