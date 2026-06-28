#!/usr/bin/env node
/**
 * PR guard for optional version bumps.
 *
 * Rules:
 * - version bump is optional even when publishable paths changed
 * - if version is bumped, semver must increase
 * - if version is bumped, CHANGELOG.md must be updated in the same diff
 * - major bumps require explicit human approval
 *
 * Publishable paths: template defaults + package.json files + pi.extensions.
 *
 * Usage:
 *   node scripts/check-version-bump.mjs
 *   BASE_REF=origin/main node scripts/check-version-bump.mjs
 *   ALLOW_MAJOR_VERSION_BUMP=1 BASE_REF=origin/main node scripts/check-version-bump.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const TEMPLATE_DEFAULT = [
  "extensions/",
  "lib/",
  "skills/",
  "prompts/",
  "themes/",
  "src/",
  "bin/",
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "package.json",
];

const SAFE_GIT_REF_RE = /^[A-Za-z0-9._/-]+$/;

function normalizeGitRef(ref, name = "git ref") {
  const value = String(ref ?? "").trim();
  if (
    !value ||
    value.startsWith("-") ||
    value.includes("..") ||
    value.includes("@{") ||
    !SAFE_GIT_REF_RE.test(value)
  ) {
    throw new Error(`${name} contains unsupported characters: ${ref}`);
  }
  return value;
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function getSemverParts(v, name = "version") {
  const parts = parseSemver(v);
  if (!parts) {
    throw new Error(`${name} must be valid semver (received ${JSON.stringify(v)})`);
  }
  return parts;
}

function compareSemver(a, b) {
  const va = getSemverParts(a, "head package.json version");
  const vb = getSemverParts(b, "base package.json version");
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] - vb[i];
  }
  return 0;
}

function isMajorBump(baseVersion, headVersion) {
  const [baseMajor] = getSemverParts(baseVersion, "base package.json version");
  const [headMajor] = getSemverParts(headVersion, "head package.json version");
  return headMajor > baseMajor;
}

function hasMajorApproval() {
  if (process.env.ALLOW_MAJOR_VERSION_BUMP === "1") return true;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return false;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const pr = event.pull_request ?? {};
    return (pr.labels ?? []).some(
      (label) => String(label.name ?? "").toLowerCase() === "major-approved",
    );
  } catch {
    return false;
  }
}

function readPackageAtRef(ref) {
  const safeRef = normalizeGitRef(ref);
  return JSON.parse(runGit(["show", `${safeRef}:package.json`]));
}

function loadPublishablePaths(...packages) {
  const paths = new Set(TEMPLATE_DEFAULT);
  for (const pkg of packages) {
    if (!pkg) continue;
    for (const entry of pkg.files ?? []) {
      paths.add(String(entry).replace(/^\.\//, ""));
    }
    for (const ext of pkg.pi?.extensions ?? []) {
      if (typeof ext === "string") {
        paths.add(ext.replace(/^\.\//, ""));
      }
    }
  }
  if (existsSync("index.ts")) paths.add("index.ts");
  return [...paths];
}

function isPublishablePath(file, publishable) {
  return publishable.some(
    (p) => file === p || (p.endsWith("/") && file.startsWith(p)),
  );
}

const hasExplicitBaseRef = Boolean(process.env.BASE_REF);
let baseRef;

try {
  baseRef = normalizeGitRef(process.env.BASE_REF ?? "origin/main", "BASE_REF");
} catch (error) {
  console.error(`version:check fail ? ${error.message}.`);
  process.exit(1);
}

let changed;
let basePackage;

try {
  runGit(["rev-parse", "--verify", baseRef]);
} catch (error) {
  if (hasExplicitBaseRef) {
    console.error(`version:check fail ? base ref is not available: ${error.message}`);
    process.exit(1);
  }
  console.log("version:check skip ? base ref not available (local run?)");
  process.exit(0);
}

try {
  changed = runGit(["diff", "--name-only", `${baseRef}...HEAD`])
    .split("\n")
    .filter(Boolean);
  basePackage = readPackageAtRef(baseRef);
} catch (error) {
  console.error(`version:check fail ? git comparison failed: ${error.message}`);
  process.exit(1);
}

const headPackage = JSON.parse(readFileSync("package.json", "utf8"));
const publishable = loadPublishablePaths(basePackage, headPackage);

const publishableChanged = changed.some((f) => isPublishablePath(f, publishable));
const baseVersion = basePackage.version;
const headVersion = headPackage.version;
let versionDelta;

try {
  versionDelta = compareSemver(headVersion, baseVersion);
} catch (error) {
  console.error(`version:check fail ? ${error.message}.`);
  process.exit(1);
}

if (versionDelta < 0) {
  console.error(
    `version:check fail ? package.json version went backwards (${baseVersion} -> ${headVersion}).`,
  );
  process.exit(1);
}

if (versionDelta === 0) {
  if (publishableChanged) {
    console.log(
      `version:check ok ? publishable paths changed with no version bump (${baseVersion} -> ${headVersion})`,
    );
  } else {
    console.log("version:check ok ? no version bump requested");
  }
  process.exit(0);
}

if (isMajorBump(baseVersion, headVersion) && !hasMajorApproval()) {
  console.error(
    "version:check fail ? major version bump requires explicit human approval. Apply the 'major-approved' PR label or rerun locally with ALLOW_MAJOR_VERSION_BUMP=1.",
  );
  process.exit(1);
}

if (!changed.includes("CHANGELOG.md")) {
  console.error(
    "version:check fail ? version bumped, but CHANGELOG.md was not updated in this PR.",
  );
  process.exit(1);
}

console.log(
  `version:check ok ? ${baseVersion} -> ${headVersion}, CHANGELOG.md updated`,
);
process.exit(0);
