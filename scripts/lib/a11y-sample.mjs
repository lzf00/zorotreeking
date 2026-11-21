/**
 * 从 sitemap 里确定性抽样页面做 a11y 巡检（第 124 轮）。
 *
 * 为什么不再手写路径表：第 123 轮往 23 条手写路径里加三条，立刻就抓到两个真 bug
 * （`/now/` 嵌套 `<main>`、留言板焦点环被抹）。这说明**问题不是"没有 bug"，而是"没看的地方不知道"**，
 * 而手写清单永远只会覆盖我记得的页面 —— 1188 个 URL 里靠人挑 26 个。
 *
 * 抽样要求：
 *   - **确定性**：同一个 seed 必须选出同一批页面，否则失败无法复现；
 *   - **分节覆盖**：`/ai/`、`/invest/`、`/photo/`、`/en/` 各模板至少各占一席，不能随机成 12 篇日报；
 *   - **不重复且均匀**：同一节里按 seed 打散后轮转取。
 */

/** 从 sitemap.xml 里取路径（去掉 origin）。 */
export function urlsFromSitemap(xml, { origin = "https://www.zorotreeking.online" } = {}) {
  const paths = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    let url = match[1];
    if (url.startsWith(origin)) url = url.slice(origin.length);
    if (!url.startsWith("/")) url = `/${url}`;
    paths.push(url);
  }
  return [...new Set(paths)];
}

/** 32 位哈希（FNV-1a），用来让 seed 决定顺序，不引入随机源。 */
export function hash(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 按 seed 稳定打散（同一个 seed 永远同一顺序）。 */
export function seededOrder(items, seed) {
  return [...items]
    .map((item) => ({ item, key: hash(`${seed}|${item}`) }))
    .sort((a, b) => a.key - b.key || (a.item < b.item ? -1 : 1))
    .map(({ item }) => item);
}

/**
 * 只出现一次的静态页归成一节。
 *
 * 第一版按第一段路径分组，结果 12 个名额被 `/privacy/`、`/terms/`、`/contact/`、`/uses/`
 * 这些"单独一页"吃掉一半 —— 它们的模板各只差几十行，测一遍就够。真正要覆盖的是
 * 日报详情、复盘详情、相册、旅行攻略、英文镜像这些**成百上千页共用一套模板**的类型。
 */
const STATIC_PAGES = new Set([
  "about", "privacy", "terms", "contact", "uses", "now", "archive", "explore",
  "changelog", "subscribe", "data", "search", "guestbook", "tag", "tools", "admin",
]);

/** 分节键：内容类型级，而不是路径级。`/ai/digest-…/` → `ai`，`/en/photo/mac1/` → `en/photo`。 */
export function sectionOf(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "static";
  if (parts[0] === "en") {
    const second = parts[1] ?? "";
    return second && !STATIC_PAGES.has(second) ? `en/${second}` : "en/static";
  }
  return STATIC_PAGES.has(parts[0]) ? "static" : parts[0];
}

/**
 * 分节轮转抽样：每个节先各取一条（节的顺序也由 seed 决定），不够再取第二轮。
 * 保证：结果不含重复、条数 = min(count, paths.length)、同一 seed 结果稳定。
 */
export function samplePaths(paths, { count = 12, seed = "default" } = {}) {
  const groups = new Map();
  for (const path of paths) {
    const key = sectionOf(path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(path);
  }
  const sections = seededOrder([...groups.keys()], seed);
  const queues = sections.map((section) => seededOrder(groups.get(section), `${seed}|${section}`));
  const picked = [];
  for (let round = 0; picked.length < count; round++) {
    let progressed = false;
    for (const queue of queues) {
      if (queue.length === 0) continue;
      const next = queue.shift();
      if (!next) continue;
      picked.push(next);
      progressed = true;
      if (picked.length >= count) break;
    }
    if (!progressed) break;
  }
  return picked;
}
