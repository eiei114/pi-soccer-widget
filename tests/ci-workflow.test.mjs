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
  const template = operations.match(
    /### 2\.2 受け入れ条件テンプレート[\s\S]*?```text([\s\S]*?)```/,
  )?.[1];
  assert.ok(template);
  assert.match(template, /確認コマンド `npm run ci` が成功する/);
  assert.doesNotMatch(template, /npm run check/);
});
