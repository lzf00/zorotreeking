/**
 * 只在交互后才需要的第三方样式，改成运行期加载（第 231 轮）。
 *
 * 起因：`astro.config.mjs` 里 `inlineStylesheets: "always"` 是量出来的有意选择（内联比
 * 外链快，见配置注释），但它把**所有**静态 import 的 CSS 都塞进 HTML —— 于是 8 个路书页
 * 和 6 个相册页，每页都内联了 14 KB 的 Leaflet 地图样式 / 5 KB 的 PhotoSwipe 灯箱样式，
 * 而这两者只有「滚到地图」或「点开大图」之后才用得上。读者不滚、不点，就是白下载。
 *
 * 做法：`import url from "xxx.css?url"`（Vite 资产 URL，不进 CSS 打包）+
 * 这里在真正要用之前插一个 `<link>` 并等它加载完。
 */
const pending = new Map<string, Promise<void>>();

/** 插入并等待一个样式表；同一 href 只会插一次。加载失败只警告、不抛错（功能不该被样式拖死）。 */
export function loadStylesheet(href: string): Promise<void> {
  const existing = pending.get(href);
  if (existing) return existing;
  const promise = new Promise<void>((resolve) => {
    if (document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => {
      console.warn("[lazy-css] 样式表加载失败", href);
      resolve();
    };
    document.head.append(link);
  });
  pending.set(href, promise);
  return promise;
}
