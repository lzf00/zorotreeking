/**
 * 线上接口面探针（第 105 轮）。
 *
 * 为什么需要：这些 `/api/*` 接口都长在"前端静默降级"的后面 —— 接口挂了，页面照样能打开，
 * 只是那一块悄悄空了。第 104 轮就发现点赞接口的 GET 坏过很久没人察觉。页面正常 ≠ 接口正常，
 * 只有主动打一遍才知道。
 *
 * 另一个教训来自本轮自己：探 `/api/market/stocks` 时我按 `600519.SH` 传参，接口回
 * `ok:false, "tencent stock quotes empty"`，看着像后端坏了；其实它要的是 secid 格式
 * （`1.600519`），传对了立刻正常。**参数格式也是契约的一部分** —— 写进表里，别靠记忆。
 *
 * 用法：
 *   node scripts/verify-api-surface.mjs                                  # 打线上
 *   node scripts/verify-api-surface.mjs --base=http://127.0.0.1:8000     # 打本地后端
 *   node scripts/verify-api-surface.mjs --only=feedback                  # 只跑一条
 *   node scripts/verify-api-surface.mjs --json                           # 机器可读
 */

/** 接口契约表：路径 / 需要的返回字段 / 这条接口喂的是页面哪一块。 */
export const ENDPOINTS = [
  {
    name: "market/etf",
    path: "/api/market/etf",
    keys: ["items"],
    powers: "ETF 三因子页 / 盘中成交",
  },
  {
    name: "market/indices",
    path: "/api/market/indices",
    keys: ["indices"],
    powers: "投资看板 · 大盘指数格（首页/投资页）",
  },
  {
    name: "market/sentiment",
    path: "/api/market/sentiment",
    keys: ["breadth"],
    powers: "投资看板 · 市场情绪",
  },
  {
    name: "market/sectors",
    path: "/api/market/sectors",
    keys: ["top_up", "top_down"],
    powers: "投资看板 · 行业板块涨跌榜",
  },
  {
    name: "market/us",
    path: "/api/market/us",
    keys: ["macro"],
    powers: "投资看板 · 美股宏观",
  },
  {
    name: "market/funds",
    path: "/api/market/funds?codes=510300",
    keys: ["funds"],
    powers: "投资看板 · 持仓净值",
  },
  {
    name: "market/stocks",
    // 注意：这里必须是 secid（1.600519），不是 600519.SH —— 传错格式接口会回 ok:false
    path: "/api/market/stocks?codes=1.600519,0.300750",
    keys: ["stocks"],
    powers: "投资看板 · AI 科创 / 创业板实时行情",
  },
  {
    name: "models",
    path: "/api/models",
    keys: ["models", "default"],
    requireOk: false, // 这个接口不返回 ok 字段
    powers: "AI 聊天挂件 · 模型下拉与能力标记",
  },
  {
    name: "feedback",
    path: "/api/feedback?slug=item%3Adeploy-probe",
    // 点赞接口没有 ok 字段，直接校验业务字段（只读探针，不写任何投票）
    keys: ["likes", "dislikes", "my_vote"],
    requireOk: false,
    powers: "文章底部「N 人觉得有用」",
  },
];

/**
 * 鉴权守卫探针：这些是后台接口，**不带 token 打过去必须被拒**。
 * 它们既是"路由还在"的健康信号，也是"鉴权没被手滑删掉"的安全信号 ——
 * 如果哪天返回 200 + 数据，说明后台数据在公网裸奔，探针会立刻红。
 */
export const AUTH_GUARDS = [
  { name: "admin/stats", path: "/api/admin/stats", powers: "访问统计看板" },
  { name: "admin/guestbook", path: "/api/admin/guestbook", powers: "留言板管理" },
  { name: "admin/etf-ops", path: "/api/admin/etf-ops", powers: "ETF 数据运维" },
];

/** 未带凭证时的预期拒绝文案（后端目前的两种表述）。 */
export const AUTH_REJECTION = /unauthorized|invalid admin token|缺少|forbidden/i;

/**
 * 故意不探的接口：POST 写接口（探测会改数据或花钱），登记在这里而不是默默漏掉。
 * 它们是 `/api/models` 那套聊天服务的写侧：发消息、清历史。读侧（models）已经探了，
 * 写侧靠 `check:interactions` 的本地桩件覆盖。
 */
export const UNPROBED = [
  { path: "/api/chat", reason: "POST 发消息，探测会消耗模型额度" },
  { path: "/api/chat/clear", reason: "POST 清历史，探测会改用户会话" },
  { path: "/api/rating", reason: "POST 写评分，探测会污染真实统计" },
  { path: "/api/track", reason: "POST 访问埋点（keepalive），探测会污染访问统计" },
  { path: "/api/admin/etf-ops/repair/cache", reason: "POST 触发后端修缓存，探测会真的改线上数据" },
  { path: "/api/data/me", reason: "按指纹返回「我的数据」，服务端 GET 可读（页面功能本身如此），不做健康探针" },
  { path: "/api/data/delete", reason: "POST 删除本人数据，探测会真的删数据" },
  { path: "/api/admin/guestbook/mod", reason: "POST 审核/删除留言，探测会真的改留言板数据" },
  { path: "/api/feedback", reason: "读侧已单独探（GET ?slug=）；POST 投票会写数据，不探" },
];

/** 鉴权守卫校验：必须被拒（不能被公开读到）。 */
export function validateAuthGuard(endpoint, status, payload) {
  const problems = [];
  if (status !== 200 && status !== 401 && status !== 403) {
    problems.push(`HTTP ${status}`);
    return problems;
  }
  const error = payload && typeof payload === "object" ? String(payload.error ?? "") : "";
  if (!error.match(AUTH_REJECTION)) {
    problems.push(`没有被拒绝（返回了 ${JSON.stringify(payload).slice(0, 80)}）—— 后台数据可能在裸奔`);
  }
  return problems;
}

/** 单条校验：返回问题描述数组，空数组表示健康。 */
export function validatePayload(endpoint, status, payload) {
  const problems = [];
  if (status !== 200) {
    problems.push(`HTTP ${status}`);
    return problems;
  }
  if (!payload || typeof payload !== "object") {
    problems.push("响应不是 JSON 对象");
    return problems;
  }
  if (endpoint.requireOk !== false && payload.ok !== true) {
    problems.push(`ok=${JSON.stringify(payload.ok)}${payload.error ? `（${payload.error}）` : ""}`);
  }
  for (const key of endpoint.keys) {
    if (!(key in payload)) problems.push(`缺字段 ${key}`);
  }
  return problems;
}

async function hit(base, endpoint) {
  const url = `${base.replace(/\/$/, "")}${endpoint.path}`;
  const response = await fetch(url, {
    headers: { "Cache-Control": "no-cache", "User-Agent": "zorotreeking-api-probe/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { url, status: response.status, payload, problems: validatePayload(endpoint, response.status, payload) };
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const base = valueOf("base") ?? "https://www.zorotreeking.online";
  const only = valueOf("only");
  const json = args.includes("--json");
  const targets = only ? ENDPOINTS.filter((e) => e.name === only) : ENDPOINTS;

  if (targets.length === 0) {
    console.error(`✗ 没有匹配 --only=${only} 的接口（可选：${ENDPOINTS.map((e) => e.name).join(", ")}）`);
    process.exit(2);
  }

  const results = [];
  for (const endpoint of targets) {
    try {
      const result = await hit(base, endpoint);
      results.push({ name: endpoint.name, ...result, powers: endpoint.powers });
    } catch (error) {
      results.push({
        name: endpoint.name,
        url: base + endpoint.path,
        status: 0,
        payload: null,
        problems: [`请求失败：${error?.message ?? error}`],
        powers: endpoint.powers,
      });
    }
  }

  for (const guard of AUTH_GUARDS) {
    const url = `${base.replace(/\/$/, "")}${guard.path}`;
    try {
      const response = await fetch(url, {
        headers: { "Cache-Control": "no-cache", "User-Agent": "zorotreeking-api-probe/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => null);
      results.push({
        name: guard.name,
        url,
        status: response.status,
        payload,
        problems: validateAuthGuard(guard, response.status, payload),
        powers: `${guard.powers}（鉴权守卫）`,
      });
    } catch (error) {
      results.push({ name: guard.name, url, status: 0, payload: null, problems: [`请求失败：${error?.message ?? error}`], powers: guard.powers });
    }
  }

  const failed = results.filter((r) => r.problems.length > 0);
  if (json) {
    console.log(JSON.stringify({ base, results, failed: failed.length }, null, 2));
  } else {
    for (const r of results) {
      if (r.problems.length === 0) {
        console.log(`✓ ${r.name.padEnd(17)} ${r.status}  ${r.powers}`);
      } else {
        console.error(`✗ ${r.name.padEnd(17)} ${r.problems.join("；")}  ← ${r.powers}`);
      }
    }
    console.log(`\n${results.length - failed.length}/${results.length} 个接口正常（base=${base}）`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
