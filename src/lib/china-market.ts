const CHINA_MARKET_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const CHINA_MARKET_TIME = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function isChinaATradingHours(date: Date = new Date()): boolean {
  const parts = Object.fromEntries(
    CHINA_MARKET_CLOCK.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
}

export function formatChinaMarketTime(timestampSeconds: number): string {
  if (!Number.isFinite(timestampSeconds)) return "—";
  return CHINA_MARKET_TIME.format(new Date(timestampSeconds * 1000));
}
