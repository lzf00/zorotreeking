/**
 * 用本地桩服务验证探针脚本本身（第 105 轮）。
 *
 * 探针跑在部署验收里、打的是线上，本机 IP 又被站点频控 —— 所以逻辑必须能在本地自证：
 * 起一个桩服务返回正常 JSON，脚本要全绿；把其中一条改成 `ok:false`，脚本必须变红。
 * 否则"探针脚本自己写错了"会变成"线上永远红"或者"线上永远绿"。
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { test } from "node:test";

const GOOD: Record<string, unknown> = {
  "/api/market/etf": { ok: true, items: [] },
  "/api/market/indices": { ok: true, indices: [] },
  "/api/market/sentiment": { ok: true, breadth: {} },
  "/api/market/sectors": { ok: true, top_up: [], top_down: [] },
  "/api/market/us": { ok: true, macro: {} },
  "/api/market/funds": { ok: true, funds: [] },
  "/api/market/stocks": { ok: true, stocks: [] },
  "/api/models": { models: ["x"], default: "x" },
  "/api/feedback": { likes: 0, dislikes: 0, my_vote: null },
  "/api/admin/stats": { error: "unauthorized" },
  "/api/admin/guestbook": { error: "invalid admin token" },
  "/api/admin/etf-ops": { error: "invalid admin token" },
};

async function withServer(
  routes: Record<string, unknown>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const body = routes[path];
    if (body === undefined) {
      res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function run(base: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/verify-api-surface.mjs", `--base=${base}`], {
      cwd: new URL("..", import.meta.url),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("桩服务正常时脚本全绿", async () => {
  await withServer(GOOD, async (base) => {
    const { code, stdout } = await run(base);
    assert.equal(code, 0, `脚本对健康接口报错了：\n${stdout}`);
    assert.match(stdout, /12\/12 个接口正常/);
  });
});

test("任一接口 ok:false 时脚本必须红", async () => {
  await withServer({ ...GOOD, "/api/market/sentiment": { ok: false, error: "upstream boom" } }, async (base) => {
    const { code, stderr } = await run(base);
    assert.equal(code, 1);
    assert.match(stderr, /market\/sentiment/);
    assert.match(stderr, /upstream boom/);
  });
});

test("后台接口返回数据（鉴权被删）时脚本必须红", async () => {
  await withServer({ ...GOOD, "/api/admin/stats": { users: 42 } }, async (base) => {
    const { code, stderr } = await run(base);
    assert.equal(code, 1);
    assert.match(stderr, /没有被拒绝/);
  });
});
