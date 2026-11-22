/**
 * 接口面探针的契约表不许漏（第 105 轮）。
 *
 * 这些 `/api/*` 都藏在"前端静默降级"后面：接口挂了，页面照样打开，只是那一块悄悄空了。
 * 第 104 轮发现点赞接口的 GET 坏过很久没人察觉；本轮又用错参数格式（`600519.SH` 而不是
 * secid `1.600519`）误判"后端坏了"。所以参数格式和返回字段都得写进表里，由测试盯着。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

import { AUTH_GUARDS, ENDPOINTS, UNPROBED, validateAuthGuard, validatePayload } from "../scripts/verify-api-surface.mjs";

const root = new URL("../", import.meta.url);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
    const rel = `${dir}${entry.name}`;
    if (entry.isDirectory()) await walk(`${rel}/`, out);
    else if (/\.(tsx?|astro|mjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

test("源码里 fetch 的每个 /api 接口都在探针表里", async () => {
  const files = await walk("src/");
  const used = new Set<string>();
  for (const file of files) {
    const text = await readFile(new URL(file, root), "utf8");
    for (const match of text.matchAll(/fetch\(`?"?(\/api\/[a-z/-]+)/g)) used.add(match[1]);
  }
  assert.ok(used.size >= 5, `只找到 ${used.size} 个接口，扫描逻辑可能失效了`);
  const probed = new Set(ENDPOINTS.map((e) => e.path.split("?")[0]));
  for (const guard of AUTH_GUARDS) probed.add(guard.path);
  const exempt = new Map(UNPROBED.map((e) => [e.path, e.reason]));
  for (const path of used) {
    if (exempt.has(path)) {
      assert.ok(exempt.get(path).length > 4, `${path} 被豁免了但没写理由`);
      continue;
    }
    assert.ok(probed.has(path), `接口 ${path} 有代码在用，但探针表里没有 —— 它挂了没人会发现`);
  }
});

test("个股行情必须用 secid 格式（本轮踩过的坑）", () => {
  const stocks = ENDPOINTS.find((e) => e.name === "market/stocks");
  assert.ok(stocks, "探针表里没有 market/stocks");
  assert.match(stocks.path, /codes=1\.\d{6}/, "又写成 600519.SH 了：那样接口会回 ok:false，看着像后端坏了");
  assert.doesNotMatch(stocks.path, /codes=\d{6}\.(SH|SZ)/);
});

test("校验逻辑：ok:false、缺字段、非 200 都要报错", () => {
  const etf = ENDPOINTS.find((e) => e.name === "market/etf");
  assert.deepEqual(validatePayload(etf, 200, { ok: true, items: [] }), []);
  assert.match(validatePayload(etf, 200, { ok: false, error: "boom" }).join(), /ok=false.*boom/);
  assert.match(validatePayload(etf, 200, { ok: true }).join(), /缺字段 items/);
  assert.match(validatePayload(etf, 502, null).join(), /HTTP 502/);
  const feedback = ENDPOINTS.find((e) => e.name === "feedback");
  assert.deepEqual(validatePayload(feedback, 200, { likes: 0, dislikes: 0, my_vote: null }), []);
  assert.match(validatePayload(feedback, 200, { ok: true }).join(), /缺字段 likes/);
});

test("每条接口都写了它喂页面哪一块（修的时候才知道影响面）", () => {
  for (const endpoint of ENDPOINTS) {
    assert.ok(endpoint.powers && endpoint.powers.length > 2, `${endpoint.name} 没写影响面`);
    assert.ok(endpoint.keys.length > 0, `${endpoint.name} 没有校验字段`);
  }
});

test("后台接口必须被鉴权拦下（谁手滑删了鉴权，探针立刻红）", () => {
  const guard = AUTH_GUARDS[0];
  assert.deepEqual(validateAuthGuard(guard, 200, { error: "unauthorized" }), []);
  assert.deepEqual(validateAuthGuard(guard, 200, { error: "invalid admin token" }), []);
  assert.match(validateAuthGuard(guard, 200, { users: 3 }).join(), /没有被拒绝/);
  assert.match(validateAuthGuard(guard, 500, null).join(), /HTTP 500/);
  assert.ok(AUTH_GUARDS.length >= 3, "守卫探针太少：至少要有统计/留言板/ETF 运维三条");
});

test("上游抖动不该顶红整条部署：失败接口重试一次（第 150 轮）", async () => {
  const source = await readFile(new URL("../scripts/verify-api-surface.mjs", import.meta.url), "utf8");
  // 第 150 轮真实事故：API 探针一次 502 就把部署顶红，prod 停在上一个版本
  assert.match(source, /retried = true/, "没有重试标记");
  assert.match(source, /setTimeout\(resolve, 2_000\)/, "重试前要等一拍，别立刻打同一个上游");
  assert.match(source, /重试通过 —— 上游抖动/, "重试通过必须写在输出里，否则等于悄悄吞掉异常");
});
