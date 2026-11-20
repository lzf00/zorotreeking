/**
 * 搜索探针进门前禁（第 91 轮）。
 *
 * 第 80 轮发现线上搜索对 4/20 个关键词直接 403（nginx 权限位），而所有烟测都是绿的：
 * 探针只打生产、门禁里没有任何一条会加载 pagefind 索引。这里把「索引可用」变成
 * 构建后的门禁项，并用静态断言把它固定住（否则下一个人删它没人知道）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";


test("门禁必须自带搜索探针（--dist），否则索引坏了没人发现", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.scripts["check:search:dist"], "node scripts/check-search.mjs --dist");
  assert.ok(
    pkg.scripts.gate.includes("npm run check:search:dist"),
    "gate 里没有搜索探针：pagefind 索引缺失/为空会直接发到线上",
  );
  // 必须排在 build 之后（索引是构建产物；build 之前跑等于检查旧 dist）
  const gate = pkg.scripts.gate;
  assert.ok(gate.indexOf("npm run build") < gate.indexOf("npm run check:search:dist"), "搜索探针必须排在 build 之后");
});

test("搜索探针 --dist 自己起服务并负责关掉它", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../scripts/check-search.mjs", import.meta.url), "utf8");
  assert.match(src, /serveDist\s*\(/, "没有复用 serveDist，等于又手搓一个静态服务器");
  assert.match(src, /server\?\.close\(\)/, "起完服务没关，门禁会挂住进程");
  assert.match(src, /"--dist"/, "缺少 --dist 分支");
});
