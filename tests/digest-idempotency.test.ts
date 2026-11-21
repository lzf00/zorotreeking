/**
 * 日报流水线必须"跑两次等于跑一次"（第 106 轮）。
 *
 * 现实：本仓库的 `schedule` 实测延迟 5–7.5 小时，11-21 那天干脆整天没触发，内容缺了三天。
 * 所以加了备用 cron。但重复触发不能变成重复花钱：`digest-fetch.ts` 原来只在**写文件**时
 * 判断"已存在"，抓源和 LLM 摘要早就跑完了 —— 备用 cron 会白烧一遍模型调用。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import { digestTargets, existingTargets } from "../scripts/digest-fetch.ts";

test("both 模式要两个文件，单流模式只要一个", () => {
  assert.deepEqual(
    digestTargets("both", "2026-11-21").map((t) => `${t.stream}/${t.file}`),
    ["ai/digest-2026-11-21.zh.mdx", "invest/digest-2026-11-21.zh.mdx"],
  );
  assert.deepEqual(digestTargets("ai", "2026-11-21").map((t) => t.stream), ["ai"]);
});

test("按流判断已有产物：AI 有了投资没写时，只补缺的那一路", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "digest-"));
  await mkdir(path.join(dir, "ai"), { recursive: true });
  await writeFile(path.join(dir, "ai", "digest-2026-11-21.zh.mdx"), "x");
  const done = await existingTargets("both", "2026-11-21", dir);
  assert.deepEqual(done.map((t) => t.stream), ["ai"], "不该把已有的那路重复生成");
  const all = await existingTargets("ai", "2026-11-21", dir);
  assert.equal(all.length, 1, "单流模式下当天已有就该全部跳过");
});

test("当天什么都没有时返回空（必须真的去生成）", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "digest-"));
  assert.deepEqual(await existingTargets("both", "2026-11-21", dir), []);
});

test("工作流有备用 cron，且 --force 能在需要时覆盖幂等", async () => {
  const wf = parse(await (await import("node:fs/promises")).readFile(
    new URL("../.github/workflows/daily-digest.yml", import.meta.url),
    "utf8",
  ));
  const crons = wf.on.schedule.map((s: { cron: string }) => s.cron);
  assert.equal(crons.length, 2, `应该有两条 cron（主 + 备用），实际：${crons.join(" / ")}`);
  assert.ok(crons.includes("17 18 * * *"));
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/digest-fetch.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /--force/, "没有 --force 就只能改文件时间戳才能重跑");
});
