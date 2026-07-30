import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchFeedback,
  parseFeedbackState,
  postFeedback,
} from "../src/lib/feedback-api";

test("feedback responses are validated before reaching UI state", () => {
  assert.deepEqual(
    parseFeedbackState({ likes: 4, dislikes: 1, my_vote: "like" }),
    { likes: 4, dislikes: 1, my_vote: "like" },
  );
  assert.throws(
    () => parseFeedbackState({ likes: "many", dislikes: -1, my_vote: "other" }),
    /invalid-feedback-response/,
  );
});

test("feedback client preserves request semantics and rate-limit errors", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(
      new URL(String(input), "https://www.zorotreeking.online"),
      init,
    );
    requests.push(request);
    if (request.method === "POST") {
      return Response.json({}, { status: 429 });
    }
    return Response.json({ likes: 2, dislikes: 0, my_vote: null });
  };

  try {
    assert.deepEqual(await fetchFeedback("ai/a&b"), {
      likes: 2,
      dislikes: 0,
      my_vote: null,
    });
    await assert.rejects(postFeedback("ai/a", "like"), /rate-limited/);
    assert.equal(requests[0].url, "https://www.zorotreeking.online/api/feedback?slug=ai%2Fa%26b");
    assert.equal(requests[1].method, "POST");
    assert.deepEqual(await requests[1].json(), { slug: "ai/a", kind: "like" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
