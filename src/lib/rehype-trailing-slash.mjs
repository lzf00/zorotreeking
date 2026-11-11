/**
 * 把正文里的站内链接补成带尾斜杠的 canonical 形式。
 *
 * 站点是 `build.format: "directory"`，每个页面都是 `<路径>/index.html`，nginx 对
 * `/about` 这种不带斜杠的地址会 301 到 `/about/`。正文（尤其是日报里的条目链接、
 * 周报里的列表）以前全写成 `/invest/digest-2026-11-01`，于是全站 49,883 处站内链接
 * 每一处都要多走一次 301 —— 跨境访问下这相当于每次点击多一个 RTT。
 *
 * 只动「看起来是页面」的链接：
 *   - 以 `/` 开头；
 *   - 最后一段不含 `.`（`.xml`、`.jpg`、`.json` 这些是静态文件，不能加斜杠）；
 *   - 不以 `/` 结尾；
 *   - 保留原有的 query / hash（相关推荐会带 ?utm_source=…）。
 */
const SKIP_PREFIXES = ["/photos/", "/og/", "/_astro/", "/pagefind/", "/gpx/", "/api/"];

/** 静态文件后缀。不能用「最后一段含点」判断：个股页是 /invest/stock/688981.SH。 */
const ASSET_EXTENSIONS = new Set([
  "xml", "json", "txt", "html", "css", "js", "mjs", "map",
  "png", "jpg", "jpeg", "webp", "avif", "gif", "svg", "ico",
  "pdf", "webmanifest", "mp4", "webm", "gpx", "zip",
]);

export function normalizeInternalHref(href) {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return href;
  const hashIndex = href.indexOf("#");
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const query = queryIndex === -1 ? "" : withoutHash.slice(queryIndex);
  const pathname = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);

  if (pathname.endsWith("/")) return href;
  if (SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return href;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const ext = lastSegment.includes(".") ? lastSegment.slice(lastSegment.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ASSET_EXTENSIONS.has(ext)) return href;

  return `${pathname}/${query}${hash}`;
}

function walk(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child);
    return;
  }
  if (node.type === "element" && node.tagName === "a" && node.properties) {
    const href = node.properties.href;
    if (typeof href === "string") {
      const next = normalizeInternalHref(href);
      if (next !== href) node.properties.href = next;
    }
  }
  if (node.children) walk(node.children);
}

export default function rehypeTrailingSlash() {
  return (tree) => walk(tree);
}
