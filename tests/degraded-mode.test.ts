/**
 * 接口全挂时页面还是不是页面（第 166 轮）。
 *
 * 全站接口都藏在"前端静默降级"后面，但没有任何检查测过降级那一半：
 * check:runtime 把 `/api/**` 桩成 200，部署后 smoke 只打真实接口。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { evaluatePage } from "../scripts/lib/degraded.mjs";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const good = { status: 200, heading: "标题", text: "内容".repeat(200), apiFailures: ["/api/market/us"] };

test("接口全挂但页面可读 → 通过", () => {
  assert.deepEqual(evaluatePage(good), { ok: true, problems: [] });
});

test("白屏、红屏、渲染事故都要被抓到", () => {
  const blank = evaluatePage({ ...good, heading: "", text: "" });
  assert.equal(blank.ok, false);
  assert.ok(blank.problems.some((p) => p.includes("主标题")));
  assert.ok(blank.problems.some((p) => p.includes("白屏")));

  const red = evaluatePage({ ...good, pageErrors: ["TypeError: x is not a function"] });
  assert.ok(red.problems.some((p) => p.includes("未捕获 JS 异常")));

  const leaking = evaluatePage({ ...good, text: `${good.text} 实时价 undefined 元` });
  assert.ok(leaking.problems.some((p) => p.includes("undefined")));
});

test("一条接口都没失败时不许算通过（否则桩没生效，检查是空转）", () => {
  const noop = evaluatePage({ ...good, apiFailures: [] });
  assert.equal(noop.ok, false);
  assert.match(noop.problems[0], /桩没生效/);
});

test("相册索引只有 256 字也要算正常（阈值按实测基线定，不是拍脑袋）", () => {
  assert.equal(evaluatePage({ ...good, text: "图".repeat(256) }).ok, true, "以图为主的页面不能被判白屏");
  assert.equal(evaluatePage({ ...good, text: "图".repeat(140) }).ok, false);
});

test("门禁里跑它，且真的把接口拦成 500", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts.gate, /check:degraded/, "不进 gate 等于没有");
  const script = await read("scripts/check-degraded.mjs");
  assert.match(script, /status: 500/, "必须是失败响应，不是空 200");
  assert.match(script, /"\*\*\/api\/\*\*"/, "要拦全部接口");
  assert.match(script, /pageerror/, "要抓未捕获异常");
});
