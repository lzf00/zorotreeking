/**
 * 性能测量的保真度（第 155 轮）。
 *
 * 事故：本地性能巡检起 `dist` 静态服务，页面里的 `/api/track`、`/api/market/*`
 * 在静态产物里不存在，服务器回 **404.html —— 124 KB**（整页内联 CSS 的壳）。
 * 线上 `/api/track` 只有 11 字节。于是每个被测页面白扛 124 KB、和字体抢带宽：
 * Inter 到达 1257ms → 拦掉后 1123ms，量出来的 LCP/CLS 掺了不存在的东西。
 *
 * 修法是在 Playwright 层 `route.fulfill` 一个小 JSON。为什么不在静态服务器里改
 * `res`：那样 `fetch(..., {keepalive:true})` 的请求在 Chrome 里永远 pending，
 * `check:hydration` 全站 `page.goto` 超时（试了 404/200、text/JSON、Connection: close、
 * 等 body 收完，全都不行）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("测量用的浏览器会把 /api/** 拦成极小响应", async () => {
  const stub = await read("scripts/lib/stub-api.mjs");
  assert.match(stub, /page\.route\("\*\*\/api\/\*\*"/, "要拦 /api/**");
  assert.match(stub, /route\.fulfill\(\{ status, contentType: "application\/json", body \}/, "要 fulfill 而不是 abort：abort 会让前端进重试分支");
  // 第 166 轮起 status 可覆盖（降级巡检要 500），但性能测量的默认值必须是 200 + 极小体
  assert.match(stub, /status = 200/, "默认必须是 200：性能巡检量的就是「接口通畅」那一半");
  const body = /\{"ok":true\}/.test(stub);
  assert.ok(body, "响应体要极小");
});

test("性能巡检在打开页面前就装好拦截", async () => {
  const runtime = await read("scripts/check-runtime.mjs");
  const stubIndex = runtime.indexOf("await stubApi(page)");
  const gotoIndex = runtime.indexOf('page.goto(');
  assert.ok(stubIndex > 0, "check-runtime 要装拦截");
  assert.ok(gotoIndex > 0 && stubIndex < gotoIndex, "拦截必须在 goto 之前，否则第一页已经多传 124 KB");
});

test("为什么不在服务器侧修：文档里必须写清楚，否则下次有人会再试一遍", async () => {
  const stub = await read("scripts/lib/stub-api.mjs");
  assert.match(stub, /keepalive/, "要写清 keepalive 请求会 pending 这个坑");
  assert.match(stub, /networkidle/, "要写清水合检查会超时");
});
