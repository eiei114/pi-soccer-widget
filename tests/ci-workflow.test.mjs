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

test("OPERATIONS.md references npm run ci as maintainer validation command", () => {
  const operations = readFileSync("OPERATIONS.md", "utf8");
  assert.match(operations, /npm run ci/);
  assert.doesNotMatch(operations, /確認コマンド `npm run check` が成功する/);
});
