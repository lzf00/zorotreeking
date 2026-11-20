/**
 * 第三方 console 噪音过滤必须「窄」（第 92 轮）。
 *
 * 背景：CI 上交互烟测红了两条内容页场景，唯一线索是 Giscus 自己的报错
 * `[giscus] An error occurred… Unexpected end of JSON input` —— 它在本机永远复现不出来。
 * 过滤这类噪音是对的，但过滤宽了会把我们自己的报错一起吞掉，那就变成假绿。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isThirdPartyConsoleNoise } from "../scripts/lib/console-noise.mjs";

test("放行 Giscus 的报错（前缀与来源 URL 两种形态）", () => {
  assert.equal(
    isThirdPartyConsoleNoise('[giscus] An error occurred. Error message: "Unexpected end of JSON input".'),
    true,
  );
  assert.equal(isThirdPartyConsoleNoise("Failed to execute 'json' on 'Response'", "https://giscus.app/client.js"), true);
  assert.equal(isThirdPartyConsoleNoise("anything at all", "https://giscus.app/api/discussions"), true);
});

test("本站自己的报错一律保留（否则就成了假绿）", () => {
  const own = [
    "TypeError: Cannot read properties of undefined (reading 'likes')",
    "console: HTTP 422: /api/feedback",
    "Uncaught (in promise) Error: hydration failed",
    'Failed to execute \'json\' on \'Response\': Unexpected end of JSON input',
    "[astro-island] island script error",
  ];
  for (const text of own) assert.equal(isThirdPartyConsoleNoise(text), false, `不该放过：${text}`);
});

test("只认 giscus 域名，别的第三方域名不自动放行", () => {
  assert.equal(isThirdPartyConsoleNoise("boom", "https://www.googletagmanager.com/gtag.js"), false);
  assert.equal(isThirdPartyConsoleNoise("boom", "https://cdn.jsdelivr.net/npm/x.js"), false);
});
