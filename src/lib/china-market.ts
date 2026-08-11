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

function chinaClockParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    CHINA_MARKET_CLOCK.formatToParts(date).map(({ type, value }) => [type, value]),
  );
}

export function isChinaATradingHours(date: Date = new Date()): boolean {
  const parts = chinaClockParts(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
}

/**
 * Published fund NAVs commonly arrive after the A-share close. Keep checking
 * through the evening instead of freezing the page at 15:00.
 */
export function isFundNavRefreshWindow(date: Date = new Date()): boolean {
  const parts = chinaClockParts(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 570 && minutes <= 1350; // 北京 09:30–22:30
}

export function formatChinaMarketTime(timestampSeconds: number): string {
  if (!Number.isFinite(timestampSeconds)) return "—";
  return CHINA_MARKET_TIME.format(new Date(timestampSeconds * 1000));
}
