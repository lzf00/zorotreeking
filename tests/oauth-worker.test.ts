import assert from "node:assert/strict";
import test from "node:test";

import worker from "../cloudflare-worker/src/index.js";

const env = {
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  ALLOWED_USERS: "allowed-user",
  CMS_ORIGIN: "https://www.zorotreeking.online",
};

async function assertNonceProtectedHtml(response: Response) {
  const csp = response.headers.get("content-security-policy") ?? "";
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, "response CSP should contain a script nonce");
  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.match(await response.text(), new RegExp(`<script nonce="${nonce}">`));
}

test("OAuth authorization stores state in a short-lived secure cookie", async () => {
  const response = await worker.fetch(
    new Request("https://oauth.example/auth"),
    env,
  );

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  const state = location.searchParams.get("state");
  assert.ok(state);
  assert.match(
    response.headers.get("set-cookie") ?? "",
    new RegExp(`decap_oauth_state=${state}.*HttpOnly.*Secure.*SameSite=Lax`),
  );
});

test("OAuth callback rejects missing or mismatched state before token exchange", async () => {
  let upstreamCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json({ access_token: "should-not-be-used" });
  };

  try {
    const response = await worker.fetch(
      new Request("https://oauth.example/callback?code=abc&state=wrong", {
        headers: { Cookie: "decap_oauth_state=expected" },
      }),
      env,
    );
    assert.equal(response.status, 400);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth callback fails closed when the user allowlist is absent", async () => {
  const response = await worker.fetch(
    new Request("https://oauth.example/callback?code=abc&state=expected", {
      headers: { Cookie: "decap_oauth_state=expected" },
    }),
    { ...env, ALLOWED_USERS: "" },
  );
  assert.equal(response.status, 500);
});

test("successful OAuth callback is non-cacheable and clears state", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    if (upstreamCalls === 1) {
      return Response.json({ access_token: "test-access-token" });
    }
    return Response.json({ login: "allowed-user" });
  };

  try {
    const response = await worker.fetch(
      new Request("https://oauth.example/callback?code=abc&state=expected", {
        headers: { Cookie: "decap_oauth_state=expected" },
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(upstreamCalls, 2);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const body = response.clone();
    assert.match(await body.text(), /https:\/\/www\.zorotreeking\.online/);
    await assertNonceProtectedHtml(response);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("denied OAuth users receive a nonce-protected closing page", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    if (upstreamCalls === 1) {
      return Response.json({ access_token: "test-access-token" });
    }
    return Response.json({ login: "denied-user" });
  };

  try {
    const response = await worker.fetch(
      new Request("https://oauth.example/callback?code=abc&state=expected", {
        headers: { Cookie: "decap_oauth_state=expected" },
      }),
      env,
    );
    assert.equal(response.status, 403);
    await assertNonceProtectedHtml(response);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shared OAuth proxy only permits the method required by each upstream", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json({ access_token: "test" });
  };

  try {
    const rejected = await worker.fetch(
      new Request("https://oauth.example/github/token"),
      env,
    );
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get("allow"), "POST");
    assert.equal(upstreamCalls, 0);

    const accepted = await worker.fetch(
      new Request("https://oauth.example/github/token", { method: "POST" }),
      env,
    );
    assert.equal(accepted.status, 200);
    assert.equal(upstreamCalls, 1);
    assert.equal(accepted.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
