import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const nextVersion = process.argv[2];

if (!nextVersion || !/^\d+\.\d+\.\d+$/.test(nextVersion)) {
  console.error("Usage: node scripts/set-version.mjs <semver>");
  process.exit(1);
}

const packageJsonPath = resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
packageJson.version = nextVersion;
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      updated: packageJsonPath,
      version: nextVersion,
    },
    null,
    2
  )
);
