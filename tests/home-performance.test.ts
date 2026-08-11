import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = async (path: string) =>
  readFile(new URL(`../src/pages/${path}`, import.meta.url), "utf8");

test("home hero LCP headings render immediately without entrance animation", async () => {
  for (const path of ["index.astro", "en/index.astro"]) {
    const source = await page(path);
    const heroHeading = source.match(/<h1\b[^>]*>/)?.[0];

    assert.ok(heroHeading, `${path} must keep a primary hero heading`);
    assert.doesNotMatch(
      heroHeading,
      /\banimate-rise\b/,
      `${path} must not delay its Lighthouse LCP element`,
    );
  }
});
