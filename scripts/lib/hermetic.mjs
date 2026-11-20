/**
 * 让浏览器自检「与外界断联」（第 93 轮）。
 *
 * 第 92 轮的教训：`Interaction smoke` 红了三次，原因不是构建坏了，而是 Giscus 的
 * client.js 在 CI 出口被限流时往 console 里刷自己的报错 —— 本机永远复现不出来。
 * 当时只是把噪音过滤掉，但那仍然意味着「发布门禁依赖第三方网络」。
 *
 * 这里改成从根上断掉：自检只验证**我们自己的构建产物**，所有第三方域名一律 abort。
 * 好处是确定性的 —— 跑多少次都一样，也不会因为外网抖动挡住发布。
 * 反过来说，第三方组件在真实网络下的可用性不该由这个门禁负责（它由线上巡检看）。
 */

/** 允许通过的协议：本地服务、内联数据、blob（图表/图片会用到） */
const LOCAL_PROTOCOL = /^(data|blob|about):/i;

/**
 * 判断一个请求该不该放行。抽成纯函数方便单测。
 * @param {string} url 请求 URL
 * @param {string} base 本地服务地址（如 http://127.0.0.1:4321）
 */
export function isHermeticRequest(url, base) {
  if (LOCAL_PROTOCOL.test(url)) return true;
  return url.startsWith(base);
}

/**
 * 给 Playwright 的 context 装上「只允许本地」的路由。
 * @param {{ route: (pattern: string, handler: (route: any) => void) => Promise<void> | void }} context
 * @param {string} base
 * @returns {{ blocked: () => string[] }} 被拦下的主机名（去重，供日志用）
 */
export async function makeContextHermetic(context, base, { allow = [] } = {}) {
  const blocked = new Set();
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (isHermeticRequest(url, base) || allow.some((prefix) => url.startsWith(prefix))) {
      return route.continue();
    }
    try {
      blocked.add(new URL(url).host);
    } catch {
      blocked.add(url.slice(0, 40));
    }
    return route.abort();
  });
  return { blocked: () => [...blocked].sort() };
}
