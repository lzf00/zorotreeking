/**
 * 自检必须与外界断联（第 93 轮）。
 *
 * 第 92 轮的真实教训：发布门禁被 Giscus 的报错挡了三次，而那个报错只在外网受限时出现。
 * 过滤噪音只是把症状按下去，根上的问题是「本地构建的自检却依赖第三方网络」。
 * 这里把「只允许本地」写成纯函数并单测，避免哪天有人为了「让某页跑通」把 allow 放宽到全网。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { isHermeticRequest } from "../scripts/lib/hermetic.mjs";

const BASE = "http://127.0.0.1:4321";

test("本地服务与内联资源放行", () => {
  assert.equal(isHermeticRequest(`${BASE}/`, BASE), true);
  assert.equal(isHermeticRequest(`${BASE}/_astro/client.js`, BASE), true);
  assert.equal(isHermeticRequest(`${BASE}/api/feedback`, BASE), true);
  assert.equal(isHermeticRequest("data:image/webp;base64,AAAA", BASE), true);
  assert.equal(isHermeticRequest("blob:http://127.0.0.1:4321/abc", BASE), true);
});

test("第三方域名一律拦住（giscus / 字体 / CDN / 高德）", () => {
  for (const url of [
    "https://giscus.app/client.js",
    "https://giscus.app/api/discussions",
    "https://fonts.gstatic.com/s/inter/x.woff2",
    "https://cdn.jsdelivr.net/npm/x.js",
    "https://webapi.amap.com/maps?v=2.0",
    "http://127.0.0.1:9999/other-port", // 端口不同也算外部，避免误连别的本地服务
  ]) {
    assert.equal(isHermeticRequest(url, BASE), false, `不该放行：${url}`);
  }
});

test("两个浏览器自检都装了断网路由（不然只修一半）", async () => {
  for (const file of ["check-interactions.mjs", "check-runtime.mjs"]) {
    const src = await readFile(new URL(`../scripts/${file}`, import.meta.url), "utf8");
    assert.match(src, /makeContextHermetic\(/, `${file} 没有断外网`);
  }
});
