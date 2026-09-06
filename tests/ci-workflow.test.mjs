import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("package.json ci script runs typecheck, test, and release:check", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts.ci, /typecheck/);
  assert.match(pkg.scripts.ci, /test/);
  assert.match(pkg.scripts.ci, /release:check/);
});

test("ci workflow invokes npm run ci", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /npm run ci/);
});

test("ci workflow invokes npm run version:check on pull requests", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const versionCheckStep = workflow.match(
    /- name: Verify version bump policy[\s\S]*?(?=\n\s*- name:|\n\s*$)/,
  )?.[0];
  assert.ok(versionCheckStep);
  assert.match(
    versionCheckStep,
    /if:\s*github\.event_name == ['"]pull_request['"]/,
  );
  assert.match(versionCheckStep, /run:\s*npm run version:check/);
});

test("CONTRIBUTING.md requires npm run ci for pull requests", () => {
  const contributing = readFileSync("CONTRIBUTING.md", "utf8");
  const guidelines = contributing.match(
    /## Pull request guidelines\n\n([\s\S]*?)\n\n## /,
  )?.[1];
  assert.ok(guidelines);
  assert.match(guidelines, /Every PR must pass `npm run ci`/);
  assert.doesNotMatch(guidelines, /Every PR must pass `npm run check`/);
});

test("CONTRIBUTING.md documents npm run version:check for pull requests", () => {
  const contributing = readFileSync("CONTRIBUTING.md", "utf8");
  const guidelines = contributing.match(
    /## Pull request guidelines\n\n([\s\S]*?)\n\n## /,
  )?.[1];
  assert.ok(guidelines);
  assert.match(guidelines, /npm run version:check/);
});

test("release-check expected tarball list includes OPERATIONS.md from package.json files", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const releaseCheck = readFileSync("scripts/release-check.mjs", "utf8");
  assert.ok(pkg.files.includes("OPERATIONS.md"));
  assert.match(releaseCheck, /"OPERATIONS\.md"/);
});

test("OPERATIONS.md references npm run ci as maintainer validation command", () => {
  const operations = readFileSync("OPERATIONS.md", "utf8");
  const template = operations.match(
    /### 2\.2 受け入れ条件テンプレート[\s\S]*?```text([\s\S]*?)```/,
  )?.[1];
  assert.ok(template);
  assert.match(template, /確認コマンド `npm run ci` が成功する/);
  assert.doesNotMatch(template, /npm run check/);
});

test("README.md documents npm run ci in Development section", () => {
  const readme = readFileSync("README.md", "utf8");
  const development = readme.match(
    /## Development\n\n```bash\n([\s\S]*?)```/,
  )?.[1];
  assert.ok(development);
  assert.match(development, /npm run ci/);
});

test("docs/examples.md club widget sample includes cache age hint", () => {
  const examples = readFileSync("docs/examples.md", "utf8");
  const clubSample = examples.match(
    /## Widget output \(club mode\)\n\n```text\n([\s\S]*?)```/,
  )?.[1];
  assert.ok(clubSample);
  assert.match(clubSample, /Soccer: .+ \| cache \d+h ago/);
  assert.match(clubSample, /Last: .+  [WDL]/);
  assert.match(clubSample, /Next: vs .+ \| \d+\/\d+ \d{2}:\d{2}/);
});

test("docs/examples.md includes World Cup widget sample with sync hint", () => {
  const examples = readFileSync("docs/examples.md", "utf8");
  const worldCupSample = examples.match(
    /## Widget output \(World Cup mode\)\n\n```text\n([\s\S]*?)```/,
  )?.[1];
  assert.ok(worldCupSample);
  assert.match(worldCupSample, /World Cup: .+ \| cache .+ \| sync ~10m/);
  assert.match(worldCupSample, /Goals:/);
});
