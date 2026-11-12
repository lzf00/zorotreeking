/**
 * AI 助手的挂载入口。
 *
 * 之前这个组件是 `client:idle` 的 React island：首屏空闲时就把 React 运行时、
 * 组件模块和样式全部求值并水合一遍，Lighthouse 桌面档在首页测出 200–580ms 的
 * 阻塞时间（去掉这个 island 后 TBT 只有 36ms）。
 *
 * 现在改成「点了才加载」：`ChatLauncher` 先渲染一个纯 HTML 按钮，点击时才用
 * 动态 import 把这一小块拉下来（约 85KB gzip），再挂到页面上。聊天面板本来
 * 也要用户点开才会出现，所以对使用没有任何影响。
 */
import { createRoot } from "react-dom/client";
import AIChatWidget from "@/components/AIChatWidget";

/** 把聊天挂件挂到 container 上，并以展开状态打开（用户已经点过一次按钮） */
export function mountAiChat(container: HTMLElement) {
  const root = createRoot(container);
  root.render(<AIChatWidget initialOpen />);
  return root;
}
