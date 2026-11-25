/**
 * 每个脚本都要有人知道它存在（第 205 轮）。
 *
 * 第 204 轮把"没有入链的页面等于不存在"做成了闸门；这一轮把同一条原则用到 `scripts/`：
 * 手动工具（量字体度量、线上全量体检、生成端调试入口）不接线是可以的，但**必须登记**，
 * 否则几个月后没人知道它存在。判定与登记都自动化，不靠记性。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { classify, listScripts } from "../scripts/check-script-index.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

const sources = {
  wired: { "package.json": '"check:demo": "node scripts/demo.mjs"' },
  code: { "tests/demo.test.ts": 'import { x } from "../scripts/lib.mjs";' },
  docs: { "docs/operations.md": "跑 `node scripts/manual-tool.mjs` 来量一次" },
};

test("接线脚本：被 package.json 引用就算有人知道", () => {
  const r = classify("scripts/demo.mjs", sources);
  assert.equal(r.status, "wired");
  assert.deepEqual(r.where, ["package.json"]);
});

test("被测试/代码 import 也算接线", () => {
  const r = classify("scripts/lib.mjs", sources);
  assert.equal(r.status, "wired");
  assert.match(r.where.join(","), /tests\/demo\.test\.ts/);
});

test("只在速查页登记 = 手动工具，合规", () => {
  const r = classify("scripts/manual-tool.mjs", sources);
  assert.equal(r.status, "documented");
});

test("谁都没提 = 无名脚本，要报出来", () => {
  const r = classify("scripts/forgotten.mjs", sources);
  assert.equal(r.status, "unknown");
});

test("Python 以 `import x` 被引用时也算接线（文件名里没有 .py）", () => {
  const pySources = {
    wired: {},
    code: { "scripts/wind/main.py": "import holidays\nprint(holidays.is_trading_day())" },
    docs: {},
  };
  assert.equal(classify("scripts/wind/holidays.py", pySources).status, "wired");
  assert.equal(classify("scripts/wind/nobody.py", pySources).status, "unknown");
});

test("采集来源时排掉脚本索引自己（它不能给自己发牌照）", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { collectSources } = await import("../scripts/check-script-index.mjs");
  const dir = await mkdtemp(path.join(tmpdir(), "script-index-"));
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await mkdir(path.join(dir, "tests"), { recursive: true });
  await mkdir(path.join(dir, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), "{}");
  await writeFile(path.join(dir, "docs", "operations.md"), "速查页");
  await writeFile(path.join(dir, "scripts", "check-script-index.mjs"), "// 名单：night-only.mjs");
  await writeFile(path.join(dir, "scripts", "night-only.mjs"), "// 夜里的工具");
  const collected = await collectSources(dir);
  assert.ok(
    !Object.keys(collected.code).some((rel) => rel.endsWith("check-script-index.mjs")),
    "脚本索引自己的文本不能进 code 证据池",
  );
});

test("真实仓库：每个脚本都有索引（接线或速查页登记）", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(process.execPath, ["scripts/check-script-index.mjs", "--json"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  const summary = JSON.parse(out);
  assert.equal(summary.unknown.length, 0, `无名脚本：${summary.unknown.join("、")}`);
  assert.ok(summary.scripts > 80, "应当扫到几十个脚本，不然是扫描逻辑坏了");
});

test("门禁里有它（本地硬失败）", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["check:script-index"] ?? "", /check-script-index\.mjs/);
  assert.ok(pkg.scripts.gate.includes("npm run check:script-index"));
});
