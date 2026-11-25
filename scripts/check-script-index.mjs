#!/usr/bin/env node
/**
 * 脚本索引检查（第 205 轮）—— 第 204 轮"孤儿页"的同一条原则，用在代码上。
 *
 * `scripts/` 里有 67 个 Node 脚本，它们分两种：
 *   1. **接线脚本**：被 `package.json` / workflow / 测试引用，跑得起来、红得起来；
 *   2. **手动工具**：只在需要的时候由人跑一次（例如量字体度量、线上全量体检）。
 *
 * 第二种的危险不是"跑不起来"，而是**没人知道它存在**：写它的那一轮记得，三个月后
 * 接手的人（或我自己）只看到一堆文件名。第 204 轮量出来的结论是"页面没有入链等于不存在"，
 * 脚本同理 —— 没有索引的手动工具等于没写过。
 *
 * 判定：每个 `scripts/**​/*.mjs|*.py` 至少要在以下之一出现（自己文件里的自我引用不算）：
 *   - `package.json` 的 scripts（接线）
 *   - `.github/workflows/*.yml`（接线）
 *   - `tests/*.ts`、`src/**`、`scripts/**`（被代码引用）
 *   - `docs/operations.md`（手动工具必须在速查页里登记）
 *
 * 用法：
 *   node scripts/check-script-index.mjs            # 人类可读；有不登记的就退出 1
 *   node scripts/check-script-index.mjs --json
 */
import { globSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 收集参考来源：接线、代码、文档 */
export async function collectSources(root) {
  const read = async (rel) => (await readFile(path.join(root, rel), "utf8")).replace(/\r\n/g, "\n");
  const wired = {};
  wired["package.json"] = await read("package.json");
  for (const rel of listFiles(root, [".github/workflows", ".husky"])) wired[rel] = await read(rel);

  const code = {};
  for (const rel of listFiles(root, ["tests", "src", "scripts"])) {
    if (/-index\.mjs$/.test(rel)) continue; // 本脚本自己的名单不算证据
    code[rel] = await read(rel);
  }

  const docs = {};
  for (const rel of ["docs/operations.md"]) docs[rel] = await read(rel);

  return { wired, code, docs };
}

function listFiles(root, dirs) {
  const out = [];
  for (const dir of dirs) {
    for (const file of globSync(`${dir}/**/*`, { cwd: root })) {
      if (!/\.(mjs|js|ts|tsx|astro|py|yml|yaml)$/.test(file)) continue;
      out.push(file.split(path.sep).join("/"));
    }
  }
  return out.sort();
}

/** 所有候选脚本（相对路径） */
export function listScripts(root) {
  return globSync("scripts/**/*.{mjs,py}", { cwd: root })
    .filter((rel) => !rel.includes("__pycache__"))
    .map((rel) => rel.split(path.sep).join("/"))
    .sort();
}

/**
 * 纯函数：判断一个脚本是否"有索引"。
 * @returns {{ status: "wired"|"documented"|"unknown", where: string[] }}
 */
export function classify(script, sources) {
  const base = path.basename(script);
  const where = [];
  let wired = false;
  for (const [rel, text] of Object.entries(sources.wired)) {
    if (text.includes(base)) {
      where.push(rel);
      wired = true;
    }
  }
  for (const [rel, text] of Object.entries(sources.code ?? {})) {
    if (rel === script) continue;
    if (text.includes(base)) {
      where.push(rel);
      wired = true;
    }
  }
  if (wired) return { status: "wired", where };
  // Python 模块常以 `import x` / `from x import y` 的形式被引用，文件名里没有 `.py`
  if (script.endsWith(".py")) {
    const mod = base.replace(/\.py$/, "");
    const importRx = new RegExp(`(?:^|\\n)\\s*(?:import ${mod}\\b|from ${mod} import)`);
    for (const [rel, text] of Object.entries(sources.code ?? {})) {
      if (rel === script || !rel.endsWith(".py")) continue;
      if (importRx.test(text)) return { status: "wired", where: [rel] };
    }
  }
  for (const [rel, text] of Object.entries(sources.docs ?? {})) {
    if (text.includes(base)) return { status: "documented", where: [rel] };
  }
  return { status: "unknown", where: [] };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const root = args.find((a) => a.startsWith("--root="))?.slice("--root=".length) ?? ROOT;
  const sources = await collectSources(root);
  const scripts = listScripts(root);
  if (scripts.length === 0) {
    console.error(`::error title=脚本索引::没扫到任何脚本 —— 这不是通过，是没测成`);
    process.exit(1);
  }
  const rows = scripts.map((script) => ({ script, ...classify(script, sources) }));
  const unknown = rows.filter((r) => r.status === "unknown");
  const documented = rows.filter((r) => r.status === "documented");
  const summary = {
    scripts: rows.length,
    wired: rows.length - unknown.length - documented.length,
    documented: documented.length,
    unknown: unknown.map((r) => r.script),
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    console.log(`脚本 ${summary.scripts} 个：接线 ${summary.wired} · 手动工具（速查页已登记）${summary.documented} · 无名 ${unknown.length}`);
    for (const row of documented) console.log(`  手动  ${row.script}`);
    for (const row of unknown) console.log(`  ✗ 无名  ${row.script}（接线它，或在 docs/operations.md 里登记）`);
    if (unknown.length === 0) console.log("✓ 每个脚本都有人知道它存在");
  }
  for (const row of unknown.slice(0, 10)) console.log(`::warning title=无名脚本::${row.script} 既没接线也没在速查页登记`);
  process.exit(unknown.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
