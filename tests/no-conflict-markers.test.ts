/**
 * 仓库里不许出现 git 冲突标记（第 183 轮）。
 *
 * 事故：2026-11-23 我在 `git rebase --continue` 前对冲突文件跑了回填脚本，然后直接
 * `git add` —— 冲突标记被当成正文提交并推送，MDX 解析器在 `<<<<<<< HEAD` 上直接报错，
 * 于是**整站构建失败**、部署全红（前一个故障刚修好，又被自己的操作覆盖）。
 *
 * 这类错误人眼容易漏（尤其是表格、代码块里），但机器一眼就能看见：
 * 任何文件里出现行首的 `<<<<<<< ` / `>>>>>>> ` 就是没解决干净的合并。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".astro", "reports", "__pycache__"]);
const SKIP_EXT = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|mp4|pdf|zip|jsonl|lock)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) walk(full, out);
    else if (!SKIP_EXT.test(name) && stat.size < 2_000_000) out.push(full);
  }
  return out;
}

test("源码、内容与 workflow 里没有冲突标记", () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("<<<<<<<") && !text.includes(">>>>>>>")) continue;
    const lines = text.split("\n");
    if (lines.some((line) => line.startsWith("<<<<<<< ") || line.startsWith(">>>>>>> ") || line === "=======")) {
      offenders.push(file.replace(`${ROOT}/`, ""));
    }
  }
  assert.deepEqual(offenders, [], `这些文件里还留着冲突标记，构建/解析会直接失败：${offenders.join(", ")}`);
});
