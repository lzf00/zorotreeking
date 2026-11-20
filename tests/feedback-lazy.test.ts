/**
 * 反馈状态按需加载（第 86 轮）。
 *
 * 事故背景：一个 digest 页面有 15–20 个 FeedbackButtons 岛，每个挂载时都
 * `GET /api/feedback?slug=...`，实测单页 21 个请求。这些请求只为填几个数字，
 * 而绝大多数访客不会点赞 —— 纯浪费移动流量和首屏资源。
 *
 * 这里锁住三件事：命中缓存不请求、同一 slug 并发只请求一次、失败后允许重试。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CACHE_TTL_MS,
  getCached,
  loadFeedback,
  putCached,
  resetCache,
} from "../src/lib/feedback-cache";

const state = (likes = 1) => ({ likes, dislikes: 0, my_vote: null });

const countingFetcher = (impl = async () => state()) => {
  const calls = [];
  const fn = async (slug) => {
    calls.push(slug);
    return impl(slug);
  };
  fn.calls = calls;
  return fn;
};

test("缓存命中时一个请求都不发", async () => {
  resetCache();
  const fetcher = countingFetcher();
  putCached("item:a", state(7));

  const got = await loadFeedback("item:a", undefined, { fetch: fetcher });
  assert.equal(got.likes, 7);
  assert.equal(fetcher.calls.length, 0);
});

test("同一 slug 的并发调用只发一次请求", async () => {
  resetCache();
  const fetcher = countingFetcher(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return state(3);
  });

  const [a, b, c] = await Promise.all([
    loadFeedback("item:b", undefined, { fetch: fetcher }),
    loadFeedback("item:b", undefined, { fetch: fetcher }),
    loadFeedback("item:b", undefined, { fetch: fetcher }),
  ]);
  assert.equal(fetcher.calls.length, 1, "并发去重失败");
  assert.deepEqual([a.likes, b.likes, c.likes], [3, 3, 3]);
});

test("不同 slug 各自请求一次，互不干扰", async () => {
  resetCache();
  const fetcher = countingFetcher(async (slug) => state(slug.length));
  await loadFeedback("item:aa", undefined, { fetch: fetcher });
  await loadFeedback("item:bbbb", undefined, { fetch: fetcher });
  assert.deepEqual(fetcher.calls, ["item:aa", "item:bbbb"]);
});

test("失败不写缓存，下一次还能重试", async () => {
  resetCache();
  let attempt = 0;
  const fetcher = countingFetcher(async () => {
    attempt++;
    if (attempt === 1) throw new Error("HTTP 422");
    return state(9);
  });

  await assert.rejects(() => loadFeedback("item:c", undefined, { fetch: fetcher }));
  assert.equal(getCached("item:c"), null);

  const retried = await loadFeedback("item:c", undefined, { fetch: fetcher });
  assert.equal(retried.likes, 9);
  assert.equal(fetcher.calls.length, 2);
});

test("缓存过期后重新请求", async () => {
  resetCache();
  const fetcher = countingFetcher(async () => state(5));
  putCached("item:d", state(1), 0);

  const before = await loadFeedback("item:d", undefined, { fetch: fetcher, now: () => CACHE_TTL_MS });
  assert.equal(before.likes, 1, "未过期应命中缓存");

  const after = await loadFeedback("item:d", undefined, { fetch: fetcher, now: () => CACHE_TTL_MS + 1 });
  assert.equal(after.likes, 5, "过期后应重新请求");
  assert.equal(fetcher.calls.length, 1);
});

test("组件挂载时不再拉取 —— 只有交互才触发（防回归）", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/components/FeedbackButtons.tsx", import.meta.url), "utf8");

  // 挂载用的 useEffect 里不允许出现 loadFeedback / fetch
  const effect = source.slice(source.indexOf("useEffect(() =>"), source.indexOf("const ensureLoaded"));
  assert.ok(effect.length > 0, "找不到挂载 effect");
  assert.ok(!/loadFeedback|fetchFeedback|fetch\(/.test(effect), `挂载 effect 里又发请求了：\n${effect}`);

  // 三个交互入口都要接上（用 () => void ensureLoaded() 包一层，避免把事件对象当参数传进去）
  for (const event of ["onPointerEnter", "onFocus", "onTouchStart"]) {
    const re = new RegExp(`${event}=\\{[^}]*ensureLoaded[^}]*\\}`);
    assert.match(source, re, `按钮缺少按需加载入口：${event}`);
  }
});

test("部署巡检里那条「不预取整页反馈」必须真的滚一遍再数（否则恒绿）", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../scripts/check-interactions.mjs", import.meta.url), "utf8");
  const at = source.indexOf("内容页：滚动一遍不预取整页反馈");
  assert.ok(at > 0, "找不到反馈预取场景");

  const block = source.slice(at, at + 1400);
  // 反馈岛是 client:visible：不滚进视口就不会挂载，也就测不到「挂载即请求」。
  assert.match(block, /scrollHeight/, "场景里必须自己滚一遍页面");
  assert.match(block, /api\/feedback/, "要真的去数 /api/feedback 请求");
  assert.match(block, /gets > 2/, "阈值是 2（含鼠标恰好停在按钮上）");

  // 变异测试结论：把按需加载改回「挂载即请求」，这条会红并报出 21 次。
  // 这里锁住阈值与滚动，避免有人为了让它绿而删除滚动。
  assert.ok(!/gets > 1\d|gets > 5/.test(block), "不许把阈值放宽");
});

test("加载失败要退化成空状态，而不是让 vote() 直接放弃（线上 GET 就是 422）", async () => {
  const { loadFeedbackOrEmpty, EMPTY_STATE } = await import("../src/lib/feedback-cache");
  resetCache();

  const ok = await loadFeedbackOrEmpty("item:ok", undefined, { fetch: async () => state(4) });
  assert.equal(ok.degraded, false);
  assert.equal(ok.state.likes, 4);

  resetCache();
  const broken = await loadFeedbackOrEmpty("item:bad", undefined, {
    fetch: async () => {
      throw new Error("HTTP 422");
    },
  });
  assert.equal(broken.degraded, true, "失败要标记为降级");
  assert.deepEqual(broken.state, EMPTY_STATE, "降级要返回空状态，否则按钮无法投票");
  assert.equal(getCached("item:bad"), null, "降级结果不许写进缓存");
});
