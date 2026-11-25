/**
 * 用到的包必须写进 package.json（第 200 轮）。
 *
 * 起因：`yaml` 从来没被声明过，却有 10 多个文件在用 —— 它能 import 成功纯粹是因为
 * 它作为 `@astrojs/check → yaml-language-server` 的传递依赖被 npm 提升到了顶层
 * `node_modules/yaml`（package-lock 里恰好是顶层条目）。而 `scripts/build-photo-manifests.ts`
 * 在**构建期**就用它：只要哪天依赖树变化、`yaml` 不再被提升（或换成 pnpm / npm ci 的不同
 * hoisting 策略），构建会直接失败，而本地因为老 node_modules 还在，什么都看不出来。
 *
 * 更麻烦的是这类故障的表现：`daily-digest` 在 2026-11-24/25 连续挂在 `Unit and guard tests`，
 * 本地在 UTC / 浅克隆 / 无 dist 三种条件下都跑不出来。依赖没声明正是最常见的"只在 CI 挂"，
 * 所以把它变成一条硬规则：**凡是裸 import 的包，必须能在 package.json 里找到**。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => name.replace(/^node:/, "")), "node"]);

/** 有意不声明：只给手动脚本用，且带 @ts-expect-error（见 scripts/photo-add.ts 注释） */
const OPTIONAL = new Map<string, string>([
  ["@aws-sdk/client-s3", "scripts/photo-add.ts 里按需 import 的可选依赖（只在用户配了 R2 时用）"],
]);

/** 框架/构建虚拟模块与路径别名，不是 npm 包 */
const VIRTUAL = /^(astro(:|$)|@\/|\/|\.\.?\/)/;

const SOURCE_DIRS = ["tests", "scripts", "src"];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx|mts|mjs|js|astro)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 从源码里抽出裸模块名（`import ... from "x"` 与 `import("x")`）。
 *
 * 逐行看、只看"像 import 语句"的行：测试文件里会**引用**别的源码片段（断言里有
 * `from "@/lib/x"` 这样的字符串、有 `import("x")` 这样的正则），逐行过滤能把它们挡掉。
 * 反斜杠出现的说明是正则转义（`@\/lib\/`），直接跳过。
 */
export function bareImports(source: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!/^(import|export|const|let|var|await|\}|\{)/.test(trimmed)) continue;
    if (/\b(assert|match|includes|test|describe|it)\s*\(/.test(trimmed)) continue;
    for (const match of trimmed.matchAll(pattern)) {
      const spec = match[1];
      if (spec.includes("\\")) continue; // 反斜杠 = 正则转义，不是真的 import
      if (VIRTUAL.test(spec) || spec.startsWith("node:")) continue;
      if (BUILTINS.has(spec)) continue;
      found.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
    }
  }
  return [...found];
}

test("bareImports 只取包名，跳过别名/虚拟模块/相对路径", () => {
  const source = `
    import { parse } from "yaml";
    import { getCollection } from "astro:content";
    import Base from "@/layouts/BaseLayout.astro";
    import local from "./local";
    import { promises as fs } from "node:fs";
    import path from "path";
    const s3 = await import("@aws-sdk/client-s3");
    const scoped = await import("@astrojs/mdx/foo");
  `;
  assert.deepEqual(bareImports(source).sort(), ["@astrojs/mdx", "@aws-sdk/client-s3", "yaml"]);
});

test("每个裸 import 的包都写进了 package.json", async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const problems = new Map<string, string[]>();
  for (const dir of SOURCE_DIRS) {
    for (const file of await walk(path.join(ROOT, dir))) {
      const source = await readFile(file, "utf8");
      for (const mod of bareImports(source)) {
        if (declared.has(mod) || OPTIONAL.has(mod)) continue;
        const where = path.relative(ROOT, file);
        problems.set(mod, [...(problems.get(mod) ?? []), where]);
      }
    }
  }
  const report = [...problems.entries()]
    .map(([mod, files]) => `${mod}（${files.length} 处，例如 ${files.slice(0, 3).join(", ")}）`)
    .join("\n");
  assert.equal(
    problems.size,
    0,
    `这些包被 import 了但没在 package.json 里声明，本地能跑只是因为被别的依赖提升到了顶层：\n${report}`,
  );
});

test("构建期真正要用的包不能进 OPTIONAL 名单", async () => {
  // build 脚本与测试都不该依赖"可选依赖"；这条防止有人把必要依赖塞进 allowlist 蒙过去
  const buildScripts = ["scripts/build-photo-manifests.ts", "scripts/check-workflows.mjs", "scripts/check-automation-health.mjs"];
  for (const rel of buildScripts) {
    const source = await readFile(path.join(ROOT, rel), "utf8");
    for (const mod of bareImports(source)) {
      assert.ok(!OPTIONAL.has(mod), `${rel} 是构建/门禁路径，不能依赖可选包 ${mod}`);
    }
  }
});
