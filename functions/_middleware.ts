// Cloudflare Pages Functions middleware
// 把 {ai,invest,photo,hike}.zorotreeking.online/<path> 内部 rewrite 到 /<section>/<path>
// 用户地址栏永远看到的是子域名形式；内部 Astro 路由用统一的 /section/ 结构。
// docs: https://developers.cloudflare.com/pages/functions/middleware/

const SUBDOMAIN_TO_SECTION: Record<string, string> = {
  ai: "ai",
  invest: "invest",
  photo: "photo",
  hike: "hike",
};

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  const apex = "zorotreeking.online";

  // 仅在生产 / preview 域名上做 rewrite；本地 dev 由 Astro 自己处理 /ai 等路径
  if (host === apex || host === `www.${apex}`) {
    return context.next();
  }

  const sub = host.endsWith(`.${apex}`) ? host.slice(0, -(apex.length + 1)) : "";
  const section = SUBDOMAIN_TO_SECTION[sub];
  if (!section) {
    return context.next();
  }

  // 已经是 /<section>/... 路径 → 直接 pass
  if (url.pathname === `/${section}` || url.pathname.startsWith(`/${section}/`)) {
    return context.next();
  }
  // 跳过 /en 前缀的情况：/en → /en/<section>
  if (url.pathname.startsWith("/en")) {
    const tail = url.pathname.slice(3) || "/";
    const rewritten = new URL(`/en/${section}${tail === "/" ? "" : tail}`, url);
    return context.env.ASSETS
      ? context.env.ASSETS.fetch(rewritten)
      : fetch(rewritten, context.request);
  }
  // 默认中文：/ → /<section>
  const tail = url.pathname === "/" ? "" : url.pathname;
  const rewritten = new URL(`/${section}${tail}`, url);
  return context.env.ASSETS
    ? context.env.ASSETS.fetch(rewritten)
    : fetch(rewritten, context.request);
};
