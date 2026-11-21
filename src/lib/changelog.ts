/**
 * /changelog 的筛选与分组规则（第 109 轮）。
 *
 * 线上实测发现的问题：这一页本意是"站点功能、性能、SEO 与无障碍改动的记录"，
 * 实际却把内部工程提交原样展示给读者 —— 页面上能看到
 * `test catch workflows that die before job 1`、`ops probe the whole /api surface`
 * 这类只有维护者才关心、而且是英文的条目，徽章上还挂着未翻译的 `test` / `ops`。
 *
 * 根因：`TYPE_LABEL[type] ?? { show: true }` —— **没登记的 type 默认显示**。
 * 新增一种提交前缀（test/ci/ops/build…）就自动泄漏到公开页面，谁也不会注意到。
 *
 * 所以这里的默认反过来了：**只显示白名单里的 type，其余一律隐藏**，并把隐藏条数报出去，
 * 保持"隐藏了什么"是透明的。
 */

import { execSync } from "node:child_process";

export interface Commit {
  hash: string;
  /** ISO 日期（YYYY-MM-DD） */
  date: string;
  /** conventional commit 的正文（去掉前缀） */
  subject: string;
  /** conventional commit 的 type，缺失时为 other */
  type: string;
}

export interface TypeStyle {
  label: string;
  color: string;
  /** 是否属于"读者会在意的改动" */
  show: boolean;
}

/**
 * 读者在意的改动：功能、修复、性能、样式、无障碍、SEO、国际化、内容、文档页。
 * 不在这里的（test / ci / ops / chore / build / refactor / auto…）默认隐藏 ——
 * 白名单比黑名单安全：以后新增前缀不会自动泄漏。
 */
export const TYPE_STYLES: Record<string, TypeStyle> = {
  feat: { label: "新功能", color: "#1d4ed8", show: true },
  fix: { label: "修复", color: "#dc2626", show: true },
  perf: { label: "性能", color: "#ea580c", show: true },
  style: { label: "样式", color: "#0891b2", show: true },
  a11y: { label: "无障碍", color: "#0d9488", show: true },
  seo: { label: "SEO", color: "#7c3aed", show: true },
  i18n: { label: "多语言", color: "#2563eb", show: true },
  content: { label: "内容", color: "#65a30d", show: true },
  docs: { label: "文档", color: "#65a30d", show: true },
  // 以下是维护者内部改动，公开页不展示
  test: { label: "测试", color: "#71717a", show: false },
  ci: { label: "流水线", color: "#71717a", show: false },
  ops: { label: "运维", color: "#71717a", show: false },
  build: { label: "构建", color: "#71717a", show: false },
  deps: { label: "依赖", color: "#71717a", show: false },
  refactor: { label: "重构", color: "#71717a", show: false },
  chore: { label: "杂项", color: "#71717a", show: false },
  auto: { label: "自动", color: "#a1a1aa", show: false },
  other: { label: "其他", color: "#71717a", show: false },
};

/** 自动化产出会用固定句式，任何 type 下都要滤掉。 */
const AUTOMATED_SUBJECTS = [
  "daily auto digest",
  "market recap",
  "refresh embeddings",
  "refresh post vectors",
];

/** 一条 commit 是否该出现在公开的更新日志里。 */
export function isVisible(commit: Commit): boolean {
  if (AUTOMATED_SUBJECTS.some((needle) => commit.subject.includes(needle))) return false;
  const style = TYPE_STYLES[commit.type];
  // 未登记的 type 一律不展示：宁可少显示，也不要把内部术语丢给读者
  return style ? style.show : false;
}

export interface ChangelogSection {
  month: string;
  commits: Commit[];
}

export interface ChangelogResult {
  sections: ChangelogSection[];
  visibleCount: number;
  hiddenCount: number;
}

/** 过滤 + 按月分组（月份倒序，月内按提交顺序即时间倒序）。 */
export function buildChangelog(commits: Commit[]): ChangelogResult {
  const visible = commits.filter(isVisible);
  const byMonth = new Map<string, Commit[]>();
  for (const commit of visible) {
    const month = commit.date.slice(0, 7);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(commit);
    else byMonth.set(month, [commit]);
  }
  const sections = [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, list]) => ({ month, commits: list }));
  return { sections, visibleCount: visible.length, hiddenCount: commits.length - visible.length };
}

/** 读仓库的 git 历史（构建期用）。浅克隆/没装 git 时返回空数组，页面自己兜底。 */
export function readGitLog(root = process.cwd()): Commit[] {
  try {
    const raw = execSync('git log --pretty=format:"%h|%ad|%s" --date=short --no-merges', {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseGitLog(raw);
  } catch (e) {
    console.warn("[git-log] unavailable:", (e as Error).message);
    return [];
  }
}

/** 解析 `git log --pretty=format:"%h|%ad|%s"` 的输出。 */
export function parseGitLog(raw: string): Commit[] {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...rest] = line.split("|");
      const rawSubject = rest.join("|");
      const match = rawSubject.match(/^(\w+)(?:\([^)]+\))?:\s*(.+)/);
      return {
        hash,
        date,
        subject: match ? match[2] : rawSubject,
        type: match ? match[1] : "other",
      };
    });
}
