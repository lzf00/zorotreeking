/**
 * 「用户收到的 HTML 是不是这一版」必须被验证（第 102 轮）。
 *
 * 起因：验证线上修复时，`deploy-meta.json` 已经是新 sha，但首页 HTML 还是旧的
 * （第三方代理缓存）。如果发生在生产 nginx 上，部署会报成功、用户看到旧页面，
 * 而且没有任何地方会红。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

import { LOCAL_STAMP, extractBuildSha } from "../scripts/check-build-stamp.mjs";

test("能从 HTML 里抽出构建标记", () => {
  assert.equal(extractBuildSha('<meta name="build" content="abc123" />'), "abc123");
  assert.equal(extractBuildSha('<META NAME="build" CONTENT="x">'), "x");
  assert.equal(extractBuildSha("<html><head></head></html>"), null, "老产物没有标记时必须是 null，不能瞎猜");
});

test("布局里注入了标记，部署时把 sha 传进构建", async () => {
  const layout = await readFile(new URL("../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
  assert.match(layout, /<meta name="build" content=\{import\.meta\.env\.PUBLIC_BUILD_SHA \?\? "local"\} \/>/);
  const deploy = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(deploy, /PUBLIC_BUILD_SHA: \$\{\{ github\.sha \}\}/, "构建时没传 sha，标记永远是 local");
  assert.match(deploy, /stale HTML at the edge/, "验收阶段没有断言 HTML 的构建标记");
  assert.match(deploy, /<meta name="build"/, "验收阶段没从首页读标记");
});

test("本地构建的占位值是 local（不是某个 sha，避免误判）", () => {
  assert.equal(LOCAL_STAMP, "local");
});

test("校验脚本：匹配放行、不匹配报错、没有标记报错", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8").catch(() => null);
  const stamp = html ? extractBuildSha(html) : "unbuilt";
  if (html) {
    const ok = spawnSync(process.execPath, ["scripts/check-build-stamp.mjs", "--file=dist/index.html", `--expect=${stamp}`], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
    assert.equal(ok.status, 0, ok.stderr);
    const bad = spawnSync(process.execPath, ["scripts/check-build-stamp.mjs", "--file=dist/index.html", "--expect=0000000"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
    assert.equal(bad.status, 1, "提交号不匹配时必须失败");
    assert.match(bad.stderr, /收到的是旧版本 HTML/);
  }
});
