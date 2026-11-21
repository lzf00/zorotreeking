/**
 * 别再在文档/正文里写死「日报几点出」（第 103 轮）。
 *
 * 这条规则是被现实教出来的：cron 从 `0 0 * * *` 改到 `17 18 * * *`，于是
 * README、集成文档、脚本注释和**写进正文的 blockquote** 全都变成了假话 ——
 * 而 GitHub 的 schedule 在本仓库实测还要再延迟 5–7.5 小时，
 * 所以任何"每天 08:00 出日报"的说法从来就没对过。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFile(new URL(p, root), "utf8");

test("仓库里没有「日报每天 08:00」这类写死钟点的说法", async () => {
  const suspects = ["README.md", "docs/INVEST_WIND_INTEGRATION.md", "scripts/digest-fetch.ts"];
  for (const file of suspects) {
    const text = await read(file);
    const hit = text.match(/每日\s*08:00|每天\s*08:00|08:00 北京/);
    assert.equal(hit, null, `${file} 还写着「${hit?.[0]}」，cron 已经不是这个时间了`);
  }
});

test("生成的正文 blockquote 不含钟点，清理脚本仍能认出新旧两种措辞", async () => {
  const digest = await read("scripts/digest-fetch.ts");
  const quote = digest.match(/> 由 cron 每日[^\n]*/g) ?? [];
  assert.ok(quote.length > 0, "找不到生成的 blockquote");
  for (const line of quote) {
    assert.doesNotMatch(line, /\d{1,2}:\d{2}/, `blockquote 里又写死了时间：${line}`);
  }
  const strip = await read("scripts/transform-strip-ai-blockquote.ts");
  assert.match(strip, /\^> 由 cron 每日\[\^\\n\]\*/, "清理脚本的匹配没放宽，老正文会漏掉");
});

test("cron 与运维速查页写的时间一致（两处都是唯一事实来源）", async () => {
  const digest = parse(await read(".github/workflows/daily-digest.yml"));
  const cron = digest.on.schedule[0].cron;
  const [minute, hour] = cron.split(" ").map(Number);
  const bjt = `${String((hour + 8) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const ops = await read("docs/operations.md");
  assert.ok(ops.includes(bjt), `operations.md 里的时间与 cron（BJT ${bjt}）不一致`);
  const readme = await read("README.md");
  assert.ok(readme.includes(bjt), `README.md 里的时间与 cron（BJT ${bjt}）不一致`);
});
