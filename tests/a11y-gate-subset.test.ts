/**
 * 双主题可访问性快检进门前禁（第 95 轮）。
 *
 * 此前 axe 只在两条周更 workflow 里跑（一条打线上、一条本地全站 2.5 分钟），
 * 都不在门禁上 —— 也就是说对比度/标题层级这类**模板级**回归可以一路推到线上，
 * 第 83 轮修的那批深色对比度问题就是线上巡检才发现的。
 *
 * 全站 46 次检查太慢，这里只放「每类模板一页」的 6 次检查（约 22 秒）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("门禁里有双主题快检，且排在 build 之后", () => {
  const gate = pkg.scripts.gate;
  assert.match(pkg.scripts["check:a11y:fast"], /check-a11y\.mjs --dist --paths=/);
  assert.ok(gate.includes("npm run check:a11y:fast"), "门禁里没有 axe 快检");
  assert.ok(gate.indexOf("npm run build") < gate.indexOf("npm run check:a11y:fast"), "必须在 build 之后（要读 dist）");
});

test("快检只挑少数模板（别把门禁变成 2.5 分钟的巡检）", () => {
  const paths = /--paths=(\S+)/.exec(pkg.scripts["check:a11y:fast"])[1].split(",").filter(Boolean);
  assert.ok(paths.length >= 2 && paths.length <= 4, `快检路径数应在 2-4 之间，收到 ${paths.length}`);
  // 至少覆盖「列表/仪表盘」与「正文」两类模板，否则回归照不到
  assert.ok(paths.some((p) => p === "/"), "缺少首页");
  assert.ok(paths.some((p) => /digest-20/.test(p)), "缺少正文页（prose 模板）");
});

test("脚本支持 --dist 与 --paths，且路径必须来自规则集", async () => {
  const src = await readFile(new URL("../scripts/check-a11y.mjs", import.meta.url), "utf8");
  assert.match(src, /let PATHS = \[/, "PATHS 必须可被 --paths 覆盖");
  assert.match(src, /不在规则集里的路径/, "拼错路径要直接报错，不能静默跑 0 页");
  assert.match(src, /serveDist/, "--dist 必须复用 serveDist");
  assert.match(src, /server\.close\(\)/, "起完服务没关，门禁会挂住进程");
});
