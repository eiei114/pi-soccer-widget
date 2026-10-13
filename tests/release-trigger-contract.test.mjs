import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectPreviousReleaseTag } from "../scripts/select-previous-release-tag.mjs";

const releaseWorkflow = await readFile(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8");
const publishWorkflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

function assertNoMergeTriggeredRelease(release, publish) {
  const releaseTriggers = release.split("permissions:")[0];
  const publishTriggers = publish.split("permissions:")[0];
  assert.match(releaseTriggers, /on:\r?\n\s+workflow_dispatch:/, "release must be manually triggered only");
  assert.doesNotMatch(releaseTriggers, /^\s+push:/m, "a merge must not start release");
  assert.match(release, /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(publishTriggers, /push:\r?\n\s+tags:/, "publishing must remain version-tag gated");
  assert.doesNotMatch(publishTriggers, /branches:|paths:/, "main branch/package edits must not publish");
  assert.match(publishTriggers, /workflow_dispatch:/, "explicit manual publishing remains available");
  assert.match(publish, /npm publish/);
}

test("merging code cannot directly or indirectly trigger npm publish or release", () => {
  assert.doesNotThrow(() => assertNoMergeTriggeredRelease(releaseWorkflow, publishWorkflow));
  assert.throws(() => assertNoMergeTriggeredRelease(
    releaseWorkflow.replace("  workflow_dispatch:", "  push:\n    branches: [main]\n  workflow_dispatch:"), publishWorkflow));
  assert.throws(() => assertNoMergeTriggeredRelease(
    releaseWorkflow, publishWorkflow.replace("    tags:", "    branches: [main]\n    tags:")));
});

test("manual release rejects malformed SemVer without leading zeros", () => {
  const pattern = releaseWorkflow.match(/grep -Eq '([^']+)'/)?.[1];
  assert.ok(pattern, "manual release must validate stable SemVer");
  const stableSemver = new RegExp(pattern);
  for (const version of ["0.0.0", "1.4.2", "10.20.300"]) assert.match(version, stableSemver);
  for (const version of ["01.4.2", "1.04.2", "1.4.02", "1.4", "1.4.2-beta"]) assert.doesNotMatch(version, stableSemver);
});

test("release notes use the highest stable tag lower than the requested version", () => {
  assert.ok(
    releaseWorkflow.includes('PREV_TAG=$(git tag --list | node scripts/select-previous-release-tag.mjs "$TAG")'),
    "release workflow must use the tested previous-tag selector",
  );

  assert.equal(
    selectPreviousReleaseTag(["v2.0.0", "v1.1.8", "v1.1.7", "v1.1.6", "v1.0.9", "v1.1.8-rc.1"], "v1.1.7"),
    "v1.1.6",
  );
  assert.equal(selectPreviousReleaseTag(["v1.9.9", "v1.10.0"], "v1.11.0"), "v1.10.0");
  assert.equal(selectPreviousReleaseTag(["v1.0.0", "not-a-version"], "v0.9.0"), "");

  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL("../scripts/select-previous-release-tag.mjs", import.meta.url)),
    "v1.1.7",
  ], { input: "v2.0.0\nv1.1.6\nv1.1.7\n", encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout, "v1.1.6\n");
});
