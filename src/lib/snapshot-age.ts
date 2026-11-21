/**
 * 数据快照的"多久以前"（第 116 轮）。
 *
 * 起因：`/invest/us/` 的兜底数据和 BLS 宏观块都停在 2026-08-11（101 天前），
 * 页面却只写一句"当前使用最近一次成功缓存"——读者会理解成"几分钟前的缓存"。
 * 金融页面上，**旧数字冒充当前数字**比没有数字更糟，所以时间必须带上日期和天数。
 *
 * 纯函数，不依赖 Date.now()：now 由调用方传入，方便测试。
 */

export type SnapshotAge = {
  /** 毫秒 → 展示文案，如 "2026-08-11 22:00（101 天前）" */
  text: string;
  /** 距今天数；无法解析时为 null */
  days: number | null;
  /** 超过这个阈值就该用醒目的样式提醒（默认 7 天） */
  severe: boolean;
};

const DAY = 86_400;

function beijingParts(date: Date) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    day: String(shifted.getUTCDate()).padStart(2, "0"),
    hour: String(shifted.getUTCHours()).padStart(2, "0"),
    minute: String(shifted.getUTCMinutes()).padStart(2, "0"),
  };
}

/** 人类可读的相对时间：今天/昨天/N 天前。 */
export function humanAge(days: number | null): string {
  if (days === null) return "时间未知";
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  return `${days} 天前`;
}

/**
 * @param seconds 秒级时间戳（后端字段都是秒）
 * @param now 当前时间（毫秒时间戳或 Date），由调用方注入
 * @param options.severeAfterDays 超过多少天算"严重陈旧"
 */
export function describeSnapshot(
  seconds: number | null | undefined,
  now: number | Date = Date.now(),
  { severeAfterDays = 7 }: { severeAfterDays?: number } = {},
): SnapshotAge {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return { text: "时间未知", days: null, severe: false };
  }
  const nowMs = typeof now === "number" ? now : now.getTime();
  const date = new Date(seconds * 1000);
  const p = beijingParts(date);
  // 跨年时才把年份写进"时:分"这一层；同年就省掉，保持界面干净
  const nowYear = beijingParts(new Date(nowMs)).year;
  const stamp = `${p.month}-${p.day} ${p.hour}:${p.minute}`;
  const days = Math.max(0, Math.floor((nowMs - seconds * 1000) / (DAY * 1000)));
  const text = p.year === nowYear ? `${stamp}（${humanAge(days)}）` : `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}（${humanAge(days)}）`;
  return { text, days, severe: days >= severeAfterDays };
}
