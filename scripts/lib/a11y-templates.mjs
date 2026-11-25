/**
 * 按「路由模板」归并页面路径（第 193 轮）。
 *
 * 背景：`check-a11y.mjs` 一直用一张**手写**的 PATHS 表决定测哪些页。第 123、133、134、
 * 181、187 轮的教训是同一个：每新增一族页面（分页、搜索页、英文面板），这张表都跟不上，
 * 于是新模板在无人审计的状态下上线。第 189–192 轮一口气加了 4 族分页页（日报/归档/标签/
 * 更新日志，合计 20+ 页），全都不在表里。
 *
 * 这里换个结构：**从构建产物反推模板**，每个模板取"第一页 + 最后一页"两页去测。
 * 分页页的尾巴（`/2/`、`/3/`）会被归回同一个模板；列表页的首末页通常已经覆盖了
 * 不同数量的条目（末页常常不满），是同一模板里最容易出布局差异的两端。
 */

/** 去掉末尾的页码段：`/archive/2/` → `/archive/`，`/tag/auto/5/` → `/tag/auto/`。 */
export function stripPageNumber(pathname) {
  const trimmed = pathname.replace(/\/+$/, "");
  const maybe = trimmed.replace(/\/[1-9]\d*$/, "");
  return maybe === "" ? "/" : `${maybe}/`;
}

/** 只按页码归并（分页页归回第一页）。 */
export function templateKey(pathname) {
  return stripPageNumber(pathname);
}

/**
 * 路由模板：在"按页码归并"之上，再把**内容页**按板块归并。
 *
 * 否则 1291 个页面会得到 1260 个"模板"（每篇文章一个 key），抽样等于把整站跑一遍。
 * 这里只做有依据的归并：四个板块下的一篇文章、标签页、个股页、日报正文页 ——
 * 它们共用同一套模板，真正的差异在内容而不在骨架。
 */
const SECTION = /^\/(?:en\/)?(ai|invest|photo|hike)\/(travel\/)?([^/]+)\/$/;
/** 板块下的"结构性"二级页：它们是独立模板，不能归并成 `/{板块}/*`。 */
const STRUCTURAL = new Set([
  "digest",
  "market",
  "market-recap",
  "stock",
  "etf",
  "us-market",
  "hk-market",
  "travel",
  "topics",
  "sample-route",
]);

export function routeTemplate(pathname) {
  const key = stripPageNumber(pathname);
  const section = key.match(SECTION);
  if (section) {
    const [, name, travel, child] = section;
    // `/hike/travel/<行程>/` 是徒步行程表模板，和普通文章不是一套骨架
    if (travel) return `/${name}/travel/*/`;
    if (STRUCTURAL.has(child)) return key;
    // 日报正文 / 复盘正文：`digest-2026-06-05`、`market-recap-2026-11-10`
    if (/^(digest|market-recap)-\d{4}-\d{2}-\d{2}$/.test(child)) return `/${name}/__date__/`;
    return `/${name}/*/`;
  }
  if (/^\/(?:en\/)?tag\/[^/]+\/$/.test(key)) return "/tag/*/";
  if (/^\/(?:en\/)?invest\/stock\/[^/]+\/$/.test(key)) return "/invest/stock/*/";
  return key;
}

/** 页码 > 1 的页面（分页页） */
export function isPaginationPage(pathname) {
  return /\/[1-9]\d*\/?$/.test(pathname) && templateKey(pathname) !== pathname;
}

/**
 * 每个模板挑哪几页：
 *   - 只有一页：就那一页；
 *   - 多页：第一页 + 最后一页（末页条目数不同，最容易暴露"空页/单条页"的排版与语义问题）。
 * 顺序稳定（按模板名排序，模板内按页码），方便 diff 报告。
 */
export function pickTemplateSamples(paths, { perTemplate = 2 } = {}) {
  const groups = new Map();
  for (const path of paths) {
    const key = routeTemplate(path);
    const list = groups.get(key);
    if (list) list.push(path);
    else groups.set(key, [path]);
  }
  const picked = [];
  for (const [key, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = list.slice().sort((a, b) => {
      const page = (p) => {
        const m = p.replace(/\/+$/, "").match(/\/([1-9]\d*)$/);
        return m ? Number(m[1]) : 1;
      };
      return page(a) - page(b) || a.localeCompare(b);
    });
    if (sorted.length <= perTemplate) picked.push(...sorted);
    else picked.push(sorted[0], ...sorted.slice(-(perTemplate - 1)));
  }
  return picked;
}

/**
 * 把模板列表切成 N 份，取第 k 份（0 基）。每周巡检用：`--template-window=3/7`。
 *
 * 为什么不是每周全量：全量 72 个模板 × 明暗两套 ≈ 9 分半，而部署 job 总预算 30 分钟
 * （rsync 就要 15+ 分钟）。切 7 份后每周 ~1.5 分钟，7 周覆盖全部模板 ——
 * 「全量太贵所以干脆不跑」才是最差的选择。
 */
export function templateWindow(items, { index = 0, of = 1 } = {}) {
  if (!Number.isInteger(of) || of < 1) throw new Error("of 必须是正整数");
  if (!Number.isInteger(index) || index < 0 || index >= of) throw new Error("index 必须落在 0..of-1");
  return items.filter((_, i) => i % of === index);
}
