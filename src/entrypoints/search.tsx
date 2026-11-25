/**
 * 搜索 modal 的挂载入口。
 *
 * 和 AI 助手一样，搜索以前是 `client:idle` 的 React island：每个页面（1145 页）
 * 首屏都要为此加载 React 运行时 + react-dom + DOMPurify + 组件（合计约 87KB，
 * 占全站首屏 JS 的九成），只是为了让用户点一下放大镜时能弹出搜索框。
 *
 * 现在改成「点了才加载」：`SearchLauncher.astro` 定义 `window.__openSearch`
 * 和 `/` 快捷键，第一次触发时才动态 import 这块，挂载后立即展开。
 */
import { createRoot } from "react-dom/client";
import SearchModal from "@/components/SearchModal";

/**
 * 把搜索 modal 挂到 container 上。
 *
 * `open` 默认 true（用户点了搜索入口）；意图预取时会以 `open: false` 静默挂载，
 * 避免「鼠标划过搜索框就弹出面板」——第 46 轮把预取和打开拆开时踩过这个坑。
 */
export function mountSearch(container: HTMLElement, { open = true }: { open?: boolean } = {}) {
  const root = createRoot(container);
  // 浮层的文案要跟着页面语言走（第 188 轮）：`/en/` 那半边此前弹出来是中文
  // "输入关键词开始搜索"。这里读 <html lang>，和 SearchLauncher 判断错误文案的方式一致。
  const lang = document.documentElement.lang === "en" ? "en" : "zh";
  root.render(<SearchModal initialOpen={open} lang={lang} />);
  return root;
}
