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
