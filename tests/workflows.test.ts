import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = async (name: string) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

test("all workflows use the Node version required by Astro 7", async () => {
  const names = [
    "bulk-backfill.yml",
    "daily-digest.yml",
    "deadlink-check.yml",
    "deploy.yml",
    "lighthouse.yml",
    "weekly-roundup.yml",
  ];
  const files = await Promise.all(names.map(workflow));
  for (const contents of files) {
    assert.doesNotMatch(contents, /node-version:\s*["']?20/);
  }
});

test("Lighthouse budget failures are not swallowed", async () => {
  assert.doesNotMatch(await workflow("lighthouse.yml"), /lhci autorun\s*\|\|\s*true/);
});

test("Lighthouse skips generated market snapshots but audits user-facing changes", () => {
  const decide = (paths: string[]) => {
    const result = spawnSync(process.execPath, ["scripts/lighthouse-scope.mjs"], {
      cwd: new URL("..", import.meta.url),
      input: `${paths.join("\n")}\n`,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  assert.equal(decide([
    "src/data/etf-three-factor-early-latest.json",
    "src/data/etf-three-factor-status.json",
  ]), "skip");
  assert.equal(decide(["src/content/ai/digest-2026-08-07.zh.mdx"]), "run");
  assert.equal(decide(["src/pages/explore.astro"]), "run");
  assert.equal(decide([]), "run");
});

test("Lighthouse workflow checks the deployed revision and keeps hidden reports", async () => {
  const contents = await workflow("lighthouse.yml");
  assert.match(contents, /statuses:\s*write/);
  assert.match(contents, /github\.event\.workflow_run\.head_sha/);
  assert.match(contents, /scripts\/lighthouse-scope\.mjs/);
  assert.match(contents, /LHCI_UPLOAD__GITHUB_TOKEN/);
  assert.match(contents, /include-hidden-files:\s*true/);
});

test("deploy keeps the Giscus stylesheet inside the production CSP", async () => {
  const contents = await workflow("deploy.yml");
  assert.match(contents, /allow\("style-src", \["https:\/\/giscus\.app"\]/);
  assert.match(contents, /Giscus stylesheet origin missing from style-src/);
});

test("daily deployment includes follow-up translation and embedding commits", async () => {
  const contents = await workflow("daily-digest.yml");
  assert.match(contents, /steps\.commit_followups\.outputs\.committed/);
  assert.match(contents, /id:\s*commit_followups/);
});

test("automated content workflows fail when all push retries fail", async () => {
  for (const name of ["daily-digest.yml", "weekly-roundup.yml"]) {
    const contents = await workflow(name);
    assert.match(contents, /if \[ "\$PUSHED" != "1" \]/);
    assert.match(contents, /exit 1/);
  }
});

test("deploy workflow never prints private key material", async () => {
  const contents = await workflow("deploy.yml");
  assert.doesNotMatch(contents, /head\s+-c\s+\d+\s+~\/\.ssh\/deploy_key/);
  assert.match(contents, /ssh-keygen -y -f ~\/\.ssh\/deploy_key >\/dev\/null/);
});

test("deploy uses versioned releases, commit identity smoke, and automatic rollback", async () => {
  const contents = await workflow("deploy.yml");
  assert.match(contents, /releases\/\$GITHUB_SHA/);
  assert.match(contents, /cp -al "\$current"\/\. "\$target"\//);
  assert.match(contents, /rsync -avz --checksum --delete/);
  assert.match(contents, /dist\/deploy-meta\.json/);
  assert.match(contents, /meta\.get\("sha"\) != os\.environ\["GITHUB_SHA"\]/);
  assert.match(contents, /Roll back failed release/);
  assert.match(contents, /steps\.activate\.outcome == 'success'/);
  assert.match(contents, /readlink -f "\$release_root\/previous"/);
});
