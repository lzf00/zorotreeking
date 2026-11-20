/**
 * 日报 LLM 预检的错误归类（scripts/digest-preflight.ts）。
 *
 * 归类值不对，修的人就会走错方向：401 要去换 Secret，404 要去改模型名，
 * 429 只能等额度 —— 这三种混成一句「调用失败」等于没诊断。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { classifyLlmError } from "../scripts/digest-preflight.ts";

const digestWorkflow = new URL("../.github/workflows/daily-digest.yml", import.meta.url);

test("各类失败都能归到「该改什么」", () => {
  const cases = [
    ["DOUBAO_API_KEY (or ARK_API_KEY) not set", "missing-key"],
    ['Doubao API 401: {"error":"invalid api key"}', "bad-key"],
    ["Doubao API 403: forbidden", "no-permission"],
    ["Doubao API 404: InvalidEndpointOrModel: the model does not exist", "model-gone"],
    ["Doubao API 429: rate limit exceeded", "quota"],
    ["The operation was aborted", "network"],
    ["ECONNRESET", "network"],
  ];
  for (const [message, kind] of cases) {
    assert.equal(classifyLlmError(new Error(message)).kind, kind, `${message} 应归为 ${kind}`);
  }
});

test("未知失败不吞掉原始信息", () => {
  const verdict = classifyLlmError(new Error("kaboom 42"));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kind, "unknown");
  assert.match(verdict.message, /kaboom 42/);
});

test("每条归类都给了可执行的下一步（不是只说失败）", () => {
  const verdicts = ["401", "404", "429", "not set"].map((token) => classifyLlmError(new Error(token)));
  for (const verdict of verdicts) {
    assert.ok(verdict.message.length > 12, `${verdict.kind} 的提示太短`);
  }
  assert.match(classifyLlmError(new Error("404")).message, /MODEL_NAME/, "模型下线时要指向写死模型名的那一行");
});

test("预检接在 fetch 之前：先诊断再干活", async () => {
  const workflow = await readFile(digestWorkflow, "utf8");
  const preflightAt = workflow.indexOf("scripts/digest-preflight.ts");
  const fetchAt = workflow.indexOf("scripts/digest-fetch.ts");
  assert.ok(preflightAt > 0, "workflow 里要跑预检");
  assert.ok(fetchAt > 0, "workflow 里当然还要跑抓取");
  assert.ok(preflightAt < fetchAt, "预检必须在抓取之前");
  assert.match(workflow, /GITHUB_STEP_SUMMARY/, "结论要进 run 页面");
});
