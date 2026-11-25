/**
 * 站点统一时区（+08:00）下的日期字符串。
 *
 * 为什么不用 `date.toISOString().slice(0, 10)`：frontmatter 里纯日期会被
 * Astro 解析成「当天 00:00 +08:00」，转成 UTC 就退回前一天，相册页会显示
 * 少一天（2026-05-26 显示成 2026-05-25）。所有「只显示日期」的地方都走这里。
 */
const SITE_TIME_ZONE = "Asia/Shanghai";

const DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function siteDateString(date: Date): string {
  const parts = Object.fromEntries(
    DAY_PARTS.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * 站点时区下的「日历日」算术（第 197 轮）。
 *
 * 热力图这类"按天铺格子"的视图不能直接对 `Date` 加减再格式化：构建机时区一变，
 * 同样的代码就会给出不同的格子（CI 跑 UTC、本地跑 +08，`/about/` 会差一天）。
 * 这里把日期当成纯日历串处理 —— 用 UTC 正午锚点做加减，永远不会跨日漂移。
 */
export function addIsoDays(iso: string, days: number): string {
  const anchor = new Date(`${iso}T00:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/** 0=周日 … 6=周六（和 `Date.prototype.getDay()` 一致，但按日历串算，与构建机时区无关） */
export function isoWeekday(iso: string): number {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}
