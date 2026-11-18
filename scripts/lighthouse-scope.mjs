#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// 「只动内容」的路径：改这些文件不会碰模板、样式、脚本，Lighthouse 分数不会变。
// 自动化任务（ETF 快照、行情日报、AI 日报）每隔十几分钟就提一次，如果每次都跑
// 14 个 URL × 5 次（35–40 分钟）的审计，concurrency 会不停把前一轮取消掉——
// 结果是审计永远跑不完、性能预算等于没有。所以内容类提交跳过，布局/代码改动照跑，
// 另有每日定时审计兜底。
const CONTENT_ONLY_PATHS = [
  // 生成的市场快照
  /^src\/data\/etf-three-factor-(?:early-latest|complete-latest|latest|status)\.json$/,
  /^src\/data\/wind-(?:market-latest|hk-market-latest|stock-details)\.json$/,
  // 内容条目（Markdown / MDX / JSON 数据文件）
  /^src\/content\//,
];

export function shouldRunLighthouse(paths) {
  const changed = paths.map((path) => path.trim()).filter(Boolean);
  // 判断不了改了什么（浅克隆、合并提交取不到 diff）时按「跑」处理，宁可多跑一次
  if (changed.length === 0) return true;
  return changed.some((path) => !CONTENT_ONLY_PATHS.some((pattern) => pattern.test(path)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = readFileSync(0, "utf8").split("\n");
  process.stdout.write(shouldRunLighthouse(paths) ? "run\n" : "skip\n");
}
