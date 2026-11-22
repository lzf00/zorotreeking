/**
 * 在测量用的浏览器里把 `/api/**` 拦成一个极小的 200 响应（第 155 轮）。
 *
 * 为什么需要：本地性能巡检起的是 `dist` 静态服务，页面里的 `/api/track`、
 * `/api/market/*` 在静态产物里不存在，服务器于是回 **404.html —— 124 KB**
 * （整页内联 CSS 的壳）。线上这些接口都是通的、`/api/track` 只有 11 字节。
 * 也就是说每个被测量的页面都白扛 124 KB，和字体/首图抢同一条 1.6 Mbps 模拟链路：
 * 实测 Inter 字体到达 1257ms → 拦掉后 1123ms。
 *
 * 为什么在 Playwright 层拦、而不是改静态服务器：
 * 改服务器控制 `res` 时，`fetch(..., { keepalive: true })` 的请求在 Chrome 里
 * **永远停在 pending**（试过 404/200、text/plain 与 JSON、`Connection: close`、
 * 等 body 收完再回包，全都不行），`networkidle` 等不到 → `check:hydration` 全站超时。
 * Playwright 的 `route.fulfill` 走的是浏览器自己的响应路径，没有这个坑。
 */
export async function stubApi(page, { body = '{"ok":true}' } = {}) {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}
