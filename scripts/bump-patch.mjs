#!/usr/bin/env node
/**
 * Auto-increment the patch version in package.json before each build.
 * This ensures every build has a unique, monotonically increasing version
 * — matching the convention used across all CPUCoin products.
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
