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

/** 拿不到服务端状态时用的空状态（按钮仍可点击投票）。 */
export const EMPTY_STATE: FeedbackState = { likes: 0, dislikes: 0, my_vote: null };

/**
 * 带降级的加载：永不抛错。
 *
 * 为什么必须这样：`vote()` 需要先知道 `my_vote` 才能算「再点一次是取消」。
 * 这个接口在线上**真的坏过很久**（GET 长期 422，计数永远为空），当时如果加载失败就直接
 * return，按钮会彻底点不动（点一下什么都不发生）。现在接口正常了（第 104 轮复查），
 * 降级仍然保留：后端再挂时按钮不能跟着一起死，只是退化成本地计数。
 *
 * @returns `{ state, degraded }`：degraded 表示这次是退化状态（不要写缓存）。
 */
export async function loadFeedbackOrEmpty(
  slug: string,
  signal?: AbortSignal,
  deps: LoadDeps = {},
): Promise<{ state: FeedbackState; degraded: boolean }> {
  try {
    return { state: await loadFeedback(slug, signal, deps), degraded: false };
  } catch {
    return { state: EMPTY_STATE, degraded: true };
  }
}
