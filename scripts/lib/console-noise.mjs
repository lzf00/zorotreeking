/**
 * 第三方脚本的 console 噪音过滤（第 92 轮）。
 *
 * 背景：`Interaction smoke` 在 CI 上红了两条内容页场景，注解里唯一的信息是
 *
 *     console: [giscus] An error occurred. Error message: "Unexpected end of JSON input"
 *
 * 这不是本站代码的问题：Giscus 的 client.js 在页面上下文里发自己的
 * `https://giscus.app/api/discussions` 请求，runner 出口被限流/拦截时它拿不到 JSON，
 * 就 `console.error` 一句。本机网络正常时永远复现不出来，于是「CI 红、本地绿」。
 *
 * 过滤必须窄：只放过能确认来源是 giscus 的报错，我们自己代码的任何报错照旧计数。
 */

/** @param {string} text console 文本 @param {string} [url] console 消息的来源 URL */
export function isThirdPartyConsoleNoise(text = "", url = "") {
  if (url.startsWith("https://giscus.app/")) return true;
  // giscus 的报错前缀固定是 "[giscus]"；同时认 「giscus.app」 字样，避免前缀改版后漏掉
  return /\[giscus\]/i.test(text) || /giscus\.app/i.test(text);
}
