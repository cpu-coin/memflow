import { cwd } from "node:process";

import { importLegacyRufloSetup } from "../dist/migrations/memflow.js";
import { createConnectorFromEnvironment } from "../dist/mcp/server.js";

const connector = createConnectorFromEnvironment();
const summary = await importLegacyRufloSetup(connector, cwd());

console.log(JSON.stringify(summary, null, 2));
