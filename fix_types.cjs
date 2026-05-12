const fs = require('fs');
let code = fs.readFileSync('src/cli.ts', 'utf8');

// 1. Remove @ts-nocheck
code = code.replace(/^\/\/ @ts-nocheck\n/m, '');

// 2. Add missing imports
const importStatements = `
import { buildHostBootstrap } from "./core/host.js";
import { startDashboard } from "./core/dashboard.js";
`;
code = code.replace(/import \{ formatVersion, getVersionInfo \} from "\.\/version\.js";/, "import { formatVersion, getVersionInfo } from \"./version.js\";\n" + importStatements);

// Also update the config import to include missing functions
code = code.replace(/import \{ findTrackedProjectForPath, getProfileConfigPath, getProfileName, mergeTrackedProjects, readMemFlowConfig, writeMemFlowConfig, \} from "\.\/core\/config\.js";/, "import { findTrackedProjectForPath, getProfileConfigPath, getProfileName, mergeTrackedProjects, readMemFlowConfig, writeMemFlowConfig, setTrackedProjectEnabled, discoverProjects } from \"./core/config.js\";");

// 3. Fix function parameter types
code = code.replace(/async function withTimeout\(promise, ms, fallback\)/, 'async function withTimeout(promise: any, ms: number, fallback: any)');
code = code.replace(/function parseFlags\(argv\)/, 'function parseFlags(argv: string[])');
code = code.replace(/const flags = {};/, 'const flags: Record<string, any> = {};');
code = code.replace(/function readStructuredInput\(flags\)/, 'function readStructuredInput(flags: Record<string, any>)');
code = code.replace(/function printJson\(value\)/, 'function printJson(value: any)');
code = code.replace(/async function runActivationGuide\(configPath\)/, 'async function runActivationGuide(configPath: string)');
code = code.replace(/function buildClaudeHookContext\(prepared\)/, 'function buildClaudeHookContext(prepared: any)');
code = code.replace(/function resolveHostBridgeInput\(source\)/, 'function resolveHostBridgeInput(source: any)');
code = code.replace(/function buildStatusPayload\(connector, config, cwd, activity\)/, 'function buildStatusPayload(connector: any, config: any, cwd: string, activity?: any)');
code = code.replace(/function formatStatusIndicator\(status\)/, 'function formatStatusIndicator(status: any)');
code = code.replace(/async function readStatusState\(configPath, cwd = process\.cwd\(\)\)/, 'async function readStatusState(configPath: string, cwd = process.cwd())');
code = code.replace(/function resolveProfile\(flags\)/, 'function resolveProfile(flags: Record<string, any>)');
code = code.replace(/function resolveConfigPath\(flags\)/, 'function resolveConfigPath(flags: Record<string, any>)');
code = code.replace(/function renderTrackedProjects\(projects\)/, 'function renderTrackedProjects(projects: any[])');

// 4. Fix specific lambda parameter types
code = code.replace(/\.map\(\(project, index\)/, '.map((project: any, index: number)');
code = code.replace(/\.map\(\(entry\)/g, '.map((entry: any)');
code = code.replace(/\.find\(\(r\)/g, '.find((r: any)');

// 5. Fix type assertions
code = code.replace(/host\), configPath\)/g, 'host as any), configPath)');
code = code.replace(/\.\.\.tracked,/, '...(tracked as any),');

// 6. Fix MemoryScope missing definition (already added in multi_replace, but we'll ensure it's exported or just kept as type)

fs.writeFileSync('src/cli.ts', code);
console.log('Fixed types in src/cli.ts');
