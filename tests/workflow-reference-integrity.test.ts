/**
 * 工作流内部引用的完整性（第 108 轮）。
 *
 * 上一轮证明了 `startup_failure` 有多致命：整条运行 1 秒钟结束、**没有任何日志**、
 * 内容流水线静默三天。除了权限越界，还有几类错误同样会让运行"在启动阶段就死"或者
 * "某个步骤永远被跳过"，而这些都能静态查出来：
 *
 *  1. `needs:` 指向不存在的 job → 工作流非法，整条不启动
 *  2. `steps.<id>.outputs` 引用了不存在的 step id → 拿到的永远是空字符串
 *  3. `github.event.inputs.X` 引用了 `workflow_dispatch` 没声明的输入 → 永远为 null
 *     （典型后果：`if: ... == 'true'` 的步骤永远不执行，还不报错）
 *  4. `run:` 里调用 `npm run <script>` 但 package.json 没有这个脚本
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const DIR = new URL("../.github/workflows/", import.meta.url);
const ROOT = new URL("../", import.meta.url);
const FILES = (await readdir(DIR)).filter((f) => f.endsWith(".yml"));
const pkg = JSON.parse(await readFile(new URL("package.json", ROOT), "utf8"));
const workflows = await Promise.all(
  FILES.map(async (file) => ({ file, wf: parse(await readFile(new URL(file, DIR), "utf8")) })),
);

test("needs 只指向存在的 job", () => {
  const problems: string[] = [];
  for (const { file, wf } of workflows) {
    const jobs = wf?.jobs ?? {};
    for (const [id, job] of Object.entries<any>(jobs)) {
      for (const need of [].concat(job?.needs ?? [])) {
        if (!(need in jobs)) problems.push(`${file}::${id} needs 不存在的 job "${need}"`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("steps.<id>.outputs 引用的 id 必须真的存在", () => {
  const problems: string[] = [];
  for (const { file, wf } of workflows) {
    for (const [id, job] of Object.entries<any>(wf?.jobs ?? {})) {
      const declared = new Set((job?.steps ?? []).map((s: any) => s?.id).filter(Boolean));
      const text = JSON.stringify(job ?? {});
      for (const match of text.matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs/g)) {
        if (!declared.has(match[1])) problems.push(`${file}::${id} 引用了不存在的 steps.${match[1]}.outputs`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("github.event.inputs.X 必须有对应的 workflow_dispatch 输入声明", () => {
  const problems: string[] = [];
  for (const { file, wf } of workflows) {
    const declared = new Set(Object.keys(wf?.on?.workflow_dispatch?.inputs ?? {}));
    for (const [id, job] of Object.entries<any>(wf?.jobs ?? {})) {
      const text = JSON.stringify(job ?? {});
      for (const match of text.matchAll(/github\.event\.inputs\.([A-Za-z0-9_]+)/g)) {
        if (!declared.has(match[1])) {
          problems.push(`${file}::${id} 用了未声明的输入 ${match[1]}（运行时永远为 null，步骤会被静默跳过）`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("run: 里调用的 npm 脚本都真实存在", () => {
  const problems: string[] = [];
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  for (const { file, wf } of workflows) {
    const text = JSON.stringify(wf?.jobs ?? {});
    for (const match of text.matchAll(/npm run ([a-z0-9:_-]+)/gi)) {
      if (!scripts.has(match[1])) problems.push(`${file} 调用了不存在的 npm 脚本 ${match[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});
