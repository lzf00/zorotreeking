/**
 * 多轮交互采样的汇总（第 129 轮）。
 *
 * 背景：同一个构建、同一台机器上，相册页"点开灯箱"实测会在 16 / 184 / 576 ms 之间跳。
 * 单次采样不足以判定，取最小值又太乐观（第二遍图片已在解码缓存里，用户第一次访问不是这个体验）。
 * 折中：跑 N 轮（默认 3），报告首轮（冷启动，最接近真实首次访问）、最快、中位数，
 * **判定用中位数** —— 只把体系性的慢判成问题，不把一次抖动判成回归。
 */

/**
 * @param {Array<Array<{action: string, ms: number, skipped?: boolean}>>} rounds 每轮的动作结果
 * @returns {Map<string, {action: string, first: number, min: number, median: number, samples: number[], skipped: boolean}>}
 */
export function aggregateRounds(rounds) {
  const out = new Map();
  for (let i = 0; i < rounds.length; i += 1) {
    for (const item of rounds[i]) {
      const prev = out.get(item.action);
      const skipped = Boolean(item.skipped);
      if (!prev) {
        out.set(item.action, { action: item.action, first: item.ms, min: item.ms, median: item.ms, samples: [item.ms], skipped });
        continue;
      }
      // 任何一轮真的没打开（skipped），这条动作就不该拿来评优 —— 标记后不参与判定
      prev.skipped = prev.skipped || skipped;
      if (skipped) continue;
      prev.samples.push(item.ms);
      prev.min = Math.min(prev.min, item.ms);
      prev.median = median(prev.samples);
    }
  }
  for (const row of out.values()) {
    if (row.skipped) row.median = Number.NaN;
  }
  return out;
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** 在若干动作里挑中位数最大的那个；skipped 的不参与 */
export function worstOf(rows) {
  let worst = null;
  for (const row of rows) {
    // 兼容只带 ms 的朴素条目（老测试/手工报告），统一看成中位数
    const value = Number.isFinite(row.median) ? row.median : row.ms;
    if (row.skipped || !Number.isFinite(value)) continue;
    if (!worst || value > (Number.isFinite(worst.median) ? worst.median : worst.ms)) worst = { ...row, median: value };
  }
  return worst;
}
