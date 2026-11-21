/**
 * /now 页的"诚实性"规则（第 110 轮）。
 *
 * 线上实测：这一页的最后更新写着 **2026-07-07**，而站点当天已经是 11-21 ——
 * 四个多月没动过，却仍然以"记录此时此刻手头的事"的口吻展示。
 * 页面可以过期，但不能**假装没过期**。
 *
 * 两条规则：
 *  1. 超过阈值就明说「这一页已经 N 天没更新」，并给出能看真实近况的入口；
 *  2. 顶部自动生成一段「最近的改动」，数据来自 git 历史 —— 人写的那部分会过期，
 *     自动生成的那部分不会，两者语气分开，读者分得清哪部分在装活人。
 */
import { TYPE_STYLES, type Commit, isVisible } from "./changelog";

/** 超过这个天数就认为"该更新了"（一个月更新一次的承诺 + 半个月宽限）。 */
export const STALE_AFTER_DAYS = 45;

export interface Staleness {
  days: number;
  stale: boolean;
  /** 给读者看的一句话；不 stale 时为 null */
  notice: string | null;
}

/** 按本地日期算天数差（只关心天，不关心时分秒）。 */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function nowStaleness(updatedIso: string, todayIso: string, threshold = STALE_AFTER_DAYS): Staleness {
  const days = daysBetween(updatedIso, todayIso);
  if (days <= threshold) return { days, stale: false, notice: null };
  return {
    days,
    stale: true,
    notice: `这一页已经 ${days} 天没更新了 —— 下面是人写的旧近况，不是今天的状态。想要真实近况，看「最近的改动」或更新日志。`,
  };
}

export interface RecentChange {
  date: string;
  label: string;
  subject: string;
  hash: string;
}

/**
 * 最近 N 天里读者能看到的改动（复用更新日志的可见性规则，自动产出与内部提交不会混进来）。
 */
export function recentChanges(
  commits: Commit[],
  options: { todayIso: string; days?: number; limit?: number } = { todayIso: "" },
): RecentChange[] {
  const days = options.days ?? 30;
  const limit = options.limit ?? 5;
  return commits
    .filter((commit) => isVisible(commit))
    .filter((commit) => daysBetween(commit.date, options.todayIso) <= days)
    .slice(0, limit)
    .map((commit) => ({
      date: commit.date,
      label: TYPE_STYLES[commit.type]?.label ?? "改动",
      subject: commit.subject,
      hash: commit.hash,
    }));
}
