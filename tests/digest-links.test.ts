import assert from "node:assert/strict";
import test from "node:test";

import { shouldLinkDigestHeadline, VOLATILE_HEADLINE_HOSTS } from "../scripts/lib/digest-links";

// 2026-11 的死链复盘：全站 66 个死链里 65 个是东方财富 7×24 快讯、1 个同花顺，
// 都是来源方当天删稿导致的。日报是永久归档，这类链接不该生成。
test("ephemeral news portals are not linked from digest headlines", () => {
  assert.equal(shouldLinkDigestHeadline("https://finance.eastmoney.com/a/202611113899000001.html"), false);
  assert.equal(shouldLinkDigestHeadline("http://global.eastmoney.com/a/202611113899000002.html"), false);
  assert.equal(shouldLinkDigestHeadline("http://futures.eastmoney.com/a/202611113899000003.html"), false);
  assert.equal(shouldLinkDigestHeadline("https://news.10jqka.com.cn/20261111/c681124809.shtml"), false);
});

test("stable sources keep their headline link", () => {
  assert.equal(shouldLinkDigestHeadline("https://arxiv.org/abs/2611.12345"), true);
  assert.equal(shouldLinkDigestHeadline("https://huggingface.co/papers/2611.12345"), true);
  assert.equal(shouldLinkDigestHeadline("https://openai.com/index/some-post"), true);
});

test("missing or malformed links never become anchors", () => {
  assert.equal(shouldLinkDigestHeadline(null), false);
  assert.equal(shouldLinkDigestHeadline(undefined), false);
  assert.equal(shouldLinkDigestHeadline(""), false);
  assert.equal(shouldLinkDigestHeadline("not a url"), false);
});

test("the volatile list stays narrow — only portals that delete same-day stories", () => {
  assert.deepEqual([...VOLATILE_HEADLINE_HOSTS], ["eastmoney.com", "10jqka.com.cn"]);
});
