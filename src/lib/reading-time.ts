// 中英混排的阅读时长估算：英文 200 wpm，中文 300 字/min
export function estimateReadingTime(body: string): number {
  if (!body) return 1;
  const cn = (body.match(/[一-龥]/g) || []).length;
  const en = body.replace(/[一-龥]/g, "").split(/\s+/).filter(Boolean).length;
  const minutes = cn / 300 + en / 200;
  return Math.max(1, Math.round(minutes));
}
