/**
 * 岛水合的判定与「像用户一样滚一遍」的滚动脚本（第 84 轮）。
 *
 * 为什么需要：`astro-island` 的元素在服务端渲染时带 `ssr` 属性，浏览器里 React 水合成功后
 * Astro 会把 `ssr` 去掉。原来的巡检只统计「有多少个岛、有没有控制台报错」，**没有验证岛
 * 真的水合了** —— 而本站 36 个岛几乎全是 `client:visible`：不滚到附近就不会水合。
 * 旧脚本只滚到页面一半，页面底部的岛（比如徒步页的 GPX 地图）永远不触发，
 * 即使它彻底坏掉也不会报错（假阴性）。
 *
 * 实测信号（2026-11 本地对比同一元素水合前后）：
 *   before: [uid,prefix,component-url,...,props,ssr,client,opts,await-children] innerHTML 272
 *   after : [uid,prefix,component-url,...,props,client,opts,await-children]      innerHTML 26884
 * 即 `ssr` 消失 + DOM 明显变大。用 `ssr` 是否存在做判定，不依赖 DOM 大小。
 */

/**
 * 纯逻辑：把页面上采集到的岛信息分成「已水合 / 未水合」。
 * @param {{ uid?: string, component?: string, hasSsr?: boolean }[]} islands
 */
export function classifyIslands(islands) {
  const hydrated = [];
  const unhydrated = [];
  for (const island of islands) {
    if (island?.hasSsr) unhydrated.push(island);
    else hydrated.push(island);
  }
  return { hydrated, unhydrated, ok: unhydrated.length === 0 };
}

/** 未水合岛的人类可读描述（报告里能直接指出是哪个组件）。 */
export function describeUnhydrated(unhydrated, limit = 4) {
  const names = unhydrated.slice(0, limit).map((island) => {
    const component = (island.component || island.uid || "unknown").split("/").pop();
    return component;
  });
  const extra = unhydrated.length > limit ? ` 等 ${unhydrated.length} 个` : "";
  return `未水合：${names.join("、")}${extra}`;
}

/**
 * 返回一段可交给 page.evaluate 的滚动脚本：分步滚到底再回顶部，每一步等一帧。
 * `client:visible` 用 IntersectionObserver 触发，必须真的进入视口才会水合。
 */
export function fullScrollScript(stepPx = 400) {
  // 注意要写成「立即调用的异步函数」：page.evaluate(字符串) 只求值表达式，
  // 传一个 `async () => {...}` 只会拿到函数本身、（Playwright 里）也不会被调用，
  // 滚动就静默地没发生 —— 表现为「只有首屏的岛水合了」。
  return `(async () => {
    const step = ${Number(stepPx)};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const height = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    for (let y = 0; y <= height(); y += step) {
      window.scrollTo(0, y);
      await sleep(60);
    }
    window.scrollTo(0, height()); // 保证最后一屏也进过视口
    await sleep(200);
    window.scrollTo(0, 0);
    await sleep(100);
  })()`;
}

/**
 * 轮询到「所有岛都摘掉 ssr」为止（默认最多 10s）。
 *
 * 为什么不能只 sleep 一个固定值：`client:visible` 先滚进视口、再去拉组件 chunk、再水合，
 * 这几步在冷缓存 + 慢机器上可能超过 2.5s。固定等待会让巡检**随机变红**（第 84 轮实测：
 * 同一份代码滚动步长 60ms 时 3 个岛没水合、80ms 时全部水合）。
 * 轮询把「慢」和「坏」分开：慢只是多等几百毫秒，坏才会一直等到超时。
 */
export async function waitForHydration(page, { timeoutMs = 10_000, pollMs = 250, readIslands } = {}) {
  const read = readIslands ?? (() =>
    page.$$eval("astro-island", (els) =>
      els.map((el) => ({
        uid: el.getAttribute("uid") ?? "",
        component: el.getAttribute("component-url") ?? "",
        hasSsr: el.hasAttribute("ssr"),
      })),
    ));
  const deadline = Date.now() + timeoutMs;
  let islands = await read();
  while (Date.now() < deadline) {
    const health = classifyIslands(islands);
    if (health.ok) return { islands, waitedMs: timeoutMs - (deadline - Date.now()), timeout: false };
    await page.waitForTimeout(pollMs);
    islands = await read();
  }
  return { islands, waitedMs: timeoutMs, timeout: true };
}
