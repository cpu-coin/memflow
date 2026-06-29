#!/usr/bin/env node
/**
 * Increment the patch/build version in package.json for deployment.
 * Regular builds must not call this script; deployment/release paths opt in
 * so local build/test runs do not mutate the project version.
 *
 * Usage: node scripts/bump-patch.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const dryRun = process.argv.includes("--dry-run");
const packageJsonPath = resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const current = packageJson.version;
const [major, minor, patch] = current.split(".").map(Number);

if (
  !/^\d+\.\d+\.\d+$/.test(current) ||
  !Number.isInteger(major) ||
  !Number.isInteger(minor) ||
  !Number.isInteger(patch)
) {
  console.error(`Cannot bump non-semver package version: ${current}`);
  process.exit(1);
}

const next = `${major}.${minor}.${patch + 1}`;

if (!dryRun) {
  packageJson.version = next;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

console.log(
  JSON.stringify(
    {
      previous: current,
      version: next,
      dryRun,
      file: packageJsonPath,
    },
    null,
    2
  )
);
