#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STABLE_TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function parseStableTag(tag) {
  const match = STABLE_TAG_PATTERN.exec(tag);
  return match ? match.slice(1).map(BigInt) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function selectPreviousReleaseTag(tags, targetTag) {
  const targetVersion = parseStableTag(targetTag);
  if (!targetVersion) throw new Error(`Target tag must be a stable SemVer tag: ${targetTag}`);

  let previousTag = "";
  let previousVersion = null;
  for (const tag of tags) {
    const version = parseStableTag(tag);
    if (
      version &&
      compareVersions(version, targetVersion) < 0 &&
      (!previousVersion || compareVersions(version, previousVersion) > 0)
    ) {
      previousTag = tag;
      previousVersion = version;
    }
  }
  return previousTag;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const targetTag = process.argv[2];
    if (!targetTag) throw new Error("Usage: select-previous-release-tag.mjs <target-tag>");
    const tags = readFileSync(0, "utf8").split(/\r?\n/);
    process.stdout.write(`${selectPreviousReleaseTag(tags, targetTag)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
