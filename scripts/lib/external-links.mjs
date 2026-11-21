/**
 * 站外链接体检的核心逻辑（第 132 轮）。
 *
 * 起因：`check:links` 只查站内。可站外链接有 **5508 条**（74 个域名，最多的是
 * news.10jqka.com.cn 1031 条、arxiv.org 946 条、finance.eastmoney.com 871 条）——
 * 日报里引的新闻稿会下线、会改版、会被反爬拦。从建站到现在没人验过一次。
 *
 * 这里的职责只有"怎么判一条链接"，抓取放在 check-external-links.mjs。
 */

/** 反爬常态化的域名：403/429 不代表链接死了，别据此报错 */
export const BOT_BLOCKING_HOSTS = [
  "x.com",
  "twitter.com",
  "www.zhihu.com",
  "zhuanlan.zhihu.com",
  "www.xiaohongshu.com",
  "www.douban.com",
  "weibo.com",
  "www.instagram.com",
  "www.facebook.com",
  "medium.com",
  "www.wsj.com",
  "www.nytimes.com",
  "www.bloomberg.com",
  "finance.yahoo.com",
];

export function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isBotBlockingHost(url, allowlist = BOT_BLOCKING_HOSTS) {
  const bare = hostOf(url);
  return allowlist.some((host) => host.replace(/^www\./, "") === bare);
}

/**
 * 把一次抓取结果归类：
 * - `ok`      2xx/3xx（fetch 已 follow，理论上到不了 3xx，但缓存或脚本输入里会有）
 * - `dead`    404 / 410 —— 真的没了，该改或删
 * - `blocked` 401/403/429 —— 反爬，不能当死链
 * - `suspect` 其他 4xx（400/405/406/451…），要人看一眼
 * - `error`   5xx / 超时 / DNS —— 对方服务器的问题，重试有意义
 * - `skipped` 反爬域名或已在基线里
 */
export function classify({ status, error, url, allowlist }) {
  if (isBotBlockingHost(url, allowlist)) return "blocked";
  if (error) {
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(error)) return "error";
    return "error";
  }
  if (status >= 200 && status < 400) return "ok";
  if (status === 404 || status === 410) return "dead";
  if (status === 401 || status === 403 || status === 429 || status === 999) return "blocked";
  if (status >= 400 && status < 500) return "suspect";
  if (status >= 500) return "error";
  return "suspect";
}

/**
 * 汇总：只把 `dead` 和基线之外的 `suspect` 当成要处理的问题。
 * 返回按域名分组的死链，方便一眼看出"是某个站整体挂了还是零散下线"。
 */
export function summarize(results, { baseline = {} } = {}) {
  const counts = { ok: 0, dead: 0, blocked: 0, suspect: 0, error: 0, skipped: 0 };
  const dead = [];
  const suspect = [];
  for (const row of results) {
    if (baseline[row.url]) {
      counts.skipped += 1;
      continue;
    }
    counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
    if (row.verdict === "dead") dead.push(row);
    if (row.verdict === "suspect") suspect.push(row);
  }
  const byHost = {};
  for (const row of dead) {
    const host = hostOf(row.url);
    byHost[host] = (byHost[host] ?? 0) + 1;
  }
  return {
    counts,
    dead,
    suspect,
    byHost: Object.entries(byHost).sort((a, b) => b[1] - a[1]),
    checked: results.length - counts.skipped,
  };
}
