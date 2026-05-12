import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const allowedPaths = [
  ".gitignore",
  ".github",
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "RELEASE.md",
  "SPEC.md",
  "ARCHITECTURE.md",
  "MCP.md",
  "CONNECTORS.md",
  "SECURITY.md",
  "package.json",
  "tsconfig.json",
  "src",
  "tests",
  "docs/claude-code-adoption.md",
  "docs/codex-mcp-adoption.md",
  "docs/import-export-examples.md",
  "docs/local-first-scaling.md",
  "docs/cloud-run-mongodb.md",
  "docs/trust-model.md",
  "docs/ops-metrics.md",
  "scripts/import-ruflo.mjs",
  "scripts/set-version.mjs",
  "scripts/bootstrap-public-repo.mjs",
];

const targetArg = process.argv[2];
if (!targetArg) {
  console.error("Usage: node scripts/bootstrap-public-repo.mjs <target-directory>");
  process.exit(1);
}

const sourceRoot = resolve(process.cwd());
const targetRoot = resolve(sourceRoot, targetArg);

if (targetRoot === sourceRoot || targetRoot.startsWith(`${sourceRoot}/`)) {
  console.error("Refusing to bootstrap into the source directory or one of its children.");
  process.exit(1);
}

if (existsSync(targetRoot)) {
  rmSync(targetRoot, { force: true, recursive: true });
}

mkdirSync(targetRoot, { recursive: true });

for (const relativePath of allowedPaths) {
  const sourcePath = resolve(sourceRoot, relativePath);
  if (!existsSync(sourcePath)) {
    continue;
  }

  const destinationPath = resolve(targetRoot, relativePath);
  cpSync(sourcePath, destinationPath, {
    recursive: true,
  });
}

console.log(
  JSON.stringify(
    {
      copied: allowedPaths,
      sourceRoot,
      targetRoot,
    },
    null,
    2
  )
);
