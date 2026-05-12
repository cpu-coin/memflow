# Developer Quickstart

Use this guide when you are opening MemFlow for the first time and want the shortest path to a working setup.

## Choose Your Tier

MemFlow supports three deployment tiers:

1. Embedded in-memory tier for app-hosted integration and AI hub shells.
2. Local SQLite tier for a single developer machine.
3. Shared MongoDB tier for multiple developers or centralized environments.

If you are not sure, start with the local SQLite tier. It is the default and requires the least setup.

## Prerequisites

- Node 22 or newer
- `npm`
- A shell in the MemFlow repository root

## First Run

From the repository root, run:

```bash
npm install
npm run build
npm test
```

If those pass, initialize the local MemFlow environment first so MemFlow can walk you through the projects, automation, and the IDE / CLI / CI surfaces you want:

```bash
npx memflow init
```

After guided setup is complete, MemFlow continues into quickstart automatically for the current repository, auto-tracking the repo, seeding recovery and persona defaults, and regenerating host configs:

```bash
npx memflow quickstart
```

If you already ran guided setup on this machine, you can jump straight to `npx memflow quickstart` on later repos.

The `init` wizard is the top-level startup path. It should be the first place you go if you are setting up a new MemFlow workspace and want to choose which projects, clients, and deployment surfaces should be active.

## Make It Available Everywhere

`npx` is fine for one-off runs, but if you want the `memflow` command available system-wide on this machine, link the package after the build step:

```bash
npm link
```

Equivalent package-manager options:

- `pnpm link --global`
- `yarn link`

If you prefer not to link the package globally, keep using `npx memflow ...` or `npm exec memflow -- ...` from the repo root.

## Connect Your Client

For Visual Studio Code, install the workspace MCP file:

```bash
npx memflow connect:vscode
```

Other supported host clients can be enabled the same way:

```bash
npx memflow connect:codex
npx memflow connect:openai
npx memflow connect:chatgpt
npx memflow connect:openai-desktop
npx memflow connect:claude-code
npx memflow connect:claude
npx memflow connect:antigravity
```

If you are wiring ChatGPT or the OpenAI desktop app, start MemFlow as a remote MCP endpoint with `npx memflow mcp --transport httpStream --port 8080` and then import the generated draft from `~/.memflow/integrations/chatgpt.json`.

Each host install reports whether MemFlow is already live or whether you need to reload the IDE or shell before it shows as connected.
For a dedicated ChatGPT / OpenAI desktop walkthrough, see `docs/chatgpt-openai-desktop.md`.

## Verify The Setup

Use these commands to confirm the install:

```bash
npx memflow status
npx memflow doctor
npx memflow validate:host --host vscode
```

## Storage Locations

- Default config: `~/.memflow/config.json`
- Default SQLite database: `~/.memflow/memflow.sqlite`
- Generated host integration files: `~/.memflow/integrations/`
- VS Code workspace MCP file: `.vscode/mcp.json`

## Embedded Mode

If MemFlow is running inside another app shell or AI hub, set the connector to embedded in-memory mode:

```bash
MEMFLOW_CONNECTOR=embedded
```

That keeps state local to the host runtime while preserving the same logical memory model.

## Shared Team Mode

For a shared workspace deployment, point MemFlow at MongoDB:

```bash
MEMFLOW_CONNECTOR=mongodb
MEMFLOW_MONGO_URI=mongodb://127.0.0.1:27017
```

You can also set `MEMFLOW_MONGO_DATABASE` or store MongoDB settings in the MemFlow config file.

## If You Get Stuck

Start with:

```bash
npx memflow status
```

If that looks healthy but the client is not wired up, rerun the relevant `connect:*` command and reload the host application or workspace.
