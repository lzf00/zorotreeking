import assert from "node:assert/strict";
import test from "node:test";

import {
  safeExternalUrl,
  sanitizeExternalTextForMdx,
} from "../scripts/lib/content-safety";

test("external digest text cannot inject HTML or MDX expressions", () => {
  const value = sanitizeExternalTextForMdx(
    '<img src=x onerror=alert(1)> {globalThis.alert(1)} **safe markdown**',
  );
  assert.equal(
    value,
    "&lt;img src=x onerror=alert(1)&gt; \\{globalThis.alert(1)\\} **safe markdown**",
  );
  assert.doesNotMatch(value, /<img|(^|[^\\])\{globalThis/);
});

test("digest links only allow HTTP and HTTPS URLs", () => {
  assert.equal(safeExternalUrl("javascript:alert(1)"), undefined);
  assert.equal(safeExternalUrl("data:text/html,pwn"), undefined);
  assert.equal(safeExternalUrl("/relative"), undefined);
  assert.equal(
    safeExternalUrl("https://example.com/paper?q=one"),
    "https://example.com/paper?q=one",
  );
  assert.equal(
    safeExternalUrl("http://example.com/news"),
    "http://example.com/news",
  );
});
