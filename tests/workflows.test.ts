import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
