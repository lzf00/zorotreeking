/**
 * 反馈状态的按需加载（第 86 轮）。
 *
 * 事故背景：一个 digest 页面有 15–20 个 `FeedbackButtons` 岛，每个都在挂载时
 * `GET /api/feedback?slug=...`，实测一个页面打开就发 **21 个** 请求。
 * 这些请求只为把「几个数字」填进去，而绝大多数访客根本不会点赞，
 * 对移动端是纯浪费（无线电流量、服务端 QPS、首屏资源竞争）。
 *
 * 改成按需：只有访客真的把鼠标移上去 / 聚焦 / 触摸 / 点击时才拉一次。
 * 同一 slug 只拉一次（并发去重 + 结果缓存），投票成功后把新状态写回缓存。
 */

import { fetchFeedback, type FeedbackState } from "./feedback-api";

/** 缓存多久之后允许重新拉（点赞数不需要实时）。 */
export const CACHE_TTL_MS = 5 * 60_000;

type Entry = { state: FeedbackState; at: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<FeedbackState>>();

/** 读取未过期的缓存。 */
export function getCached(slug: string, now = Date.now()): FeedbackState | null {
  const hit = cache.get(slug);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(slug);
    return null;
  }
  return hit.state;
}

/** 写入缓存（投票成功、或首次加载成功后调用）。 */
export function putCached(slug: string, state: FeedbackState, now = Date.now()): void {
  cache.set(slug, { state, at: now });
}

/** 仅供测试：清空缓存与在途请求。 */
export function resetCache(): void {
  cache.clear();
  inflight.clear();
}

export interface LoadDeps {
  fetch?: (slug: string, signal?: AbortSignal) => Promise<FeedbackState>;
  now?: () => number;
}

/**
 * 取某个 slug 的反馈状态：命中缓存直接返回；同一 slug 已有在途请求则复用，
 * 不会再多发一次。失败时会清掉在途记录，允许下次重试。
 */
export async function loadFeedback(
  slug: string,
  signal?: AbortSignal,
  deps: LoadDeps = {},
): Promise<FeedbackState> {
  const now = deps.now ?? Date.now;
  const cached = getCached(slug, now());
  if (cached) return cached;

  const running = inflight.get(slug);
  if (running) return running;

  const fetch = deps.fetch ?? fetchFeedback;
  const promise = fetch(slug, signal)
    .then((state) => {
      putCached(slug, state, now());
      return state;
    })
    .finally(() => {
      inflight.delete(slug);
    });
  inflight.set(slug, promise);
  return promise;
}
