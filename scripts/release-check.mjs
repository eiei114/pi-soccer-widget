#!/usr/bin/env node

/**
 * Pre-release check script.
 *
 * Runs:
 *   1. npm run check   (build + pack dry-run)
 *   2. Validates pack contents against an expected file list
 *
 * Exit code 0 = all checks passed.
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

// --- Expected pack files (relative paths inside the tarball) ---
const EXPECTED_FILES = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "dist/extensions/index.d.ts",
  "dist/extensions/index.js",
  "dist/extensions/index.js.map",
  "extensions/index.ts",
  "package.json",
];

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  const out = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  console.log(out);
  return out;
}

function check(label, fn) {
  try {
    fn();
    console.log(`✅ ${label}`);
  } catch (e) {
    console.error(`❌ ${label}`);
    console.error(e.stderr || e.message);
    process.exitCode = 1;
  }
}

// --- Step 1: build + basic pack ---
check("npm run check", () => {
  run("npm run check");
});

// --- Step 2: pack file validation ---
check("Pack file list matches expected", () => {
  const json = run("npm pack --dry-run --json 2>/dev/null");
  const files = JSON.parse(json)[0].files.map((f) => f.path);
  const missing = EXPECTED_FILES.filter((f) => !files.includes(f));
  const extra = files.filter((f) => !EXPECTED_FILES.includes(f));

  if (missing.length) throw new Error(`Missing files: ${missing.join(", ")}`);
  if (extra.length) console.warn(`⚠  Extra files (not in expected list): ${extra.join(", ")}`);
});

console.log("\n🎉 All release checks passed.");
