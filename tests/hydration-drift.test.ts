/**
 * 跨天 / 跨时区的水合漂移门禁（第 217 轮）。
 *
 * 第 215、216 两轮连着抓到两只同类 bug：渲染路径里读了时钟。
 * 这类 bug 只在"跨过某个边界"的访问者身上出现，本地跑一遍永远绿 ——
 * 所以护栏不是读源码，而是把环境弄歪再打开页面。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  driftVariants,
  summarise,
  templateSignature,
} from "../scripts/check-hydration-drift.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("同模板的日期/序号差异被折成同一个签名", () => {
  assert.equal(templateSignature("/ai/digest-2026-11-25/"), templateSignature("/ai/digest-2026-06-05/"));
  assert.equal(templateSignature("/en/invest/market-recap-2026-11-25/"), "/en/invest/market-recap-:date/");
  assert.equal(templateSignature("/ai/weekly-2026-W47/"), "/ai/weekly-2026-:week/");
  assert.equal(templateSignature("/tag/etf/"), "/tag/etf/", "普通路径不该被改写");
  assert.notEqual(templateSignature("/ai/digest-2026-11-25/"), templateSignature("/invest/digest-2026-11-25/"));
});

test("探针必须真的把环境弄歪（时钟 + 时区各一种）", () => {
  const variants = driftVariants();
  assert.equal(variants.length, 2);
  const clock = variants.find((v) => v.shiftDays > 0);
  assert.ok(clock, "要有跨天的一种");
  assert.ok(clock!.shiftDays >= 7, "挪得太少（1 天）可能撞不上边界");
  const tz = variants.find((v) => v.timezoneId !== "Asia/Shanghai");
  assert.ok(tz, "要有非北京时区的一种");
  assert.notEqual(tz!.locale, "zh-CN", "跨时区同时要换语言，才能逼出默认 locale 的格式化差异");
  for (const variant of variants) assert.ok(variant.why && variant.why.length > 10, "每种环境要写清为什么");
});

test("只要有 pageerror 就算失败，并指出是哪页哪种环境", () => {
  const ok = summarise([
    { path: "/a/", variant: "clock+10d", errors: [] },
    { path: "/b/", variant: "tz", errors: [] },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.checked, 2);

  const bad = summarise([
    { path: "/a/", variant: "clock+10d", errors: ["pageerror: Minified React error #418"] },
    { path: "/b/", variant: "tz", errors: [] },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.failures.length, 1);
  assert.equal(bad.failures[0].path, "/a/");
  assert.match(bad.failures[0].errors[0], /#418/);
});

test("门禁里接上了它，并且排在构建之后", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["check:hydration-drift"], "node scripts/check-hydration-drift.mjs");
  const gate = pkg.scripts.gate as string;
  assert.ok(gate.includes("check:hydration-drift"), "gate 里要跑");
  assert.ok(gate.indexOf("npm run build") < gate.indexOf("check:hydration-drift"), "必须跑在构建产物上");
});

test("抽样是每周换一批、同 seed 稳定（否则覆盖永远停在同样几页）", async () => {
  const src = await read("scripts/check-hydration-drift.mjs");
  assert.match(src, /weeklySeed/, "seed 默认要按周算");
  assert.match(src, /samplePaths/, "复用既有分节轮转抽样，别自己写一套");
  assert.match(src, /--paths=/, "要能手工指定页面来复现");
});
