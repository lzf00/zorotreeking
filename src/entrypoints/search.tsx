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

/** 把搜索 modal 挂到 container 上，并立刻展开 */
export function mountSearch(container: HTMLElement) {
  const root = createRoot(container);
  root.render(<SearchModal initialOpen />);
  return root;
}
