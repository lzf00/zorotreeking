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

/**
 * 一天里 A 股的哪个阶段。收盘后和开盘前虽然都"不能交易"，但页面上该说的话不一样：
 * 盘前说"未开盘/开盘后更新"，收盘后说"已收盘"，周末说"休市"。
 * 2026-11 之前 ETF 页在 08:50 显示"（已收盘）"、实时进度列写着"基准待补采"，
 * 把"今天还没开盘"说成了"昨天的数据丢了"，看着像故障。
 */
export type ChinaMarketPhase = "weekend" | "premarket" | "morning" | "lunch" | "afternoon" | "closed";

export function chinaMarketPhase(date: Date = new Date()): ChinaMarketPhase {
  const parts = chinaClockParts(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "weekend";

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes < 570) return "premarket"; // 09:30 之前
  if (minutes <= 690) return "morning"; // 09:30–11:30
  if (minutes < 780) return "lunch"; // 11:30–13:00
  if (minutes <= 900) return "afternoon"; // 13:00–15:00
  return "closed";
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
