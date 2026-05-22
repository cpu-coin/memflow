# MemFlow™

**[→ What is MemFlow? Read the About page](./ABOUT.md)**

MemFlow™ is a portable shared-memory layer for AI coding agents.

Its purpose is narrow:
- store and retrieve useful development knowledge across sessions
- support prompt caching and pattern reuse for coding workflows
- provide deterministic import, export, and merge for shared team memory
- expose a small, safe MCP surface for local agent use

MemFlow explicitly does not try to be a chat UI, swarm runtime, browser automation suite, shell runner, or general-purpose autonomous agent platform.

It is designed to fit a broader product plan in which:
- model vendors increasingly own orchestration
- MemFlow owns persistent, portable, secure code memory
- downstream products can embed or connect to MemFlow without expanding its attack surface

## Product Positioning

MemFlow is the reduced, security-first product extracted from the broader `claude-flow` codebase. It keeps the subset that provides repeatable value and removes the rest from scope.

Existing RuFlo users are not expected to re-enter prior local memory manually. MemFlow includes a legacy detection/import path so a prior RuFlo footprint can be discovered and migrated into the new product.

Working product statement:

> Portable shared memory and prompt caching for coding agents, with safe local-first deployment and deterministic team sharing.

Current stable release target:

- `1.0.0`

## Overview

MemFlow's current public feature set is intentionally small:

- local-first memory CRUD
- prompt-cache read and write support
- deterministic import, export, and merge
- SQLite and MongoDB backends
- legacy RuFlo import
- namespace and project scoping
- security sweep on write operations
- fixed MCP tool allowlist
- versioned CLI and release checks
- **mobile bridge (ag_bridge) pattern** — two dedicated MCP tools (`mobile_read_inbox`, `mobile_respond`) that power headless mobile-to-agent communication with no CDP or Accessibility permissions required

## Founding Context

MemFlow is being developed as a spoke in the broader CPUcoin / equilibrium.com product wheel.

The larger platform direction begins with:

> The Hybrid Decentralized Cloud For AI

Within that context, MemFlow is the focused memory and shared-knowledge layer rather than a general orchestration product.

## Trademark Notice

`MemFlow` and `MemFlow™` are trademarks of dServices Limited, trading as CPUcoin.

Use of the marks should follow CPUcoin brand guidelines and attribution requirements.

## Attribution

Where customary and appropriate, MemFlow should be attributed as:

- a CPUcoin / equilibrium.com ecosystem product
- developed under dServices Limited, trading as CPUcoin
- part of the broader "The Hybrid Decentralized Cloud For AI" platform direction

## Design Principles

- local-first by default
- portable storage with deterministic behavior across backends
- fixed allowlist of MCP tools
- no autonomous execution loops
- no hidden fallbacks
- no dynamic remote tool injection
- explicit provenance for shared memory entries
- secure-by-default configuration

## Runtime Requirement

MemFlow now targets Node 22 or newer for local development and runtime consistency.

Recommended local setup:

```bash
nvm use
npm rebuild better-sqlite3
npm run build
```

If `nvm` is not available, use any Node 22+ runtime, then rebuild `better-sqlite3` in that same shell before running MemFlow.

## Start Here

If you are the first developer trying to get MemFlow running, use the quickstart guide:

- [docs/developer-quickstart.md](./docs/developer-quickstart.md)

The shortest practical path is:

```bash
npm install
npm run build
npm test
npx memflow init
npm link
```

`memflow init` is the real guided startup: it walks through the top-level projects, automation choices, and the IDE / CLI / CI surfaces you want to turn on, then continues into quickstart after a successful interactive setup. Quickstart seeds the repo's recovery and persona defaults as part of that handoff.
If you need to rerun the repo bootstrap later, use `npx memflow quickstart` directly.

Use `npx memflow connect:vscode` after onboarding if you want to wire the current workspace into VS Code right away.
The CLI also accepts `npx memflow connect:openai` for the OpenAI Codex path, `npx memflow connect:chatgpt` for the OpenAI ChatGPT / desktop code-mode path, and `npx memflow connect:claude` for Claude Code.
For ChatGPT / OpenAI desktop, run `npx memflow mcp --transport httpStream --port 8080` (or point it at your hosted HTTPS endpoint) and import the generated connector draft from `~/.memflow/integrations/chatgpt.json`.
Each install reports whether MemFlow is already on and connected or whether the IDE, ChatGPT app, or shell needs a reload first.
See [`docs/chatgpt-openai-desktop.md`](docs/chatgpt-openai-desktop.md) for the dedicated ChatGPT / OpenAI desktop flow.
If you prefer not to link globally, keep using `npx memflow ...` or `npm exec memflow -- ...`.

## Planned Storage Modes

- `in-memory`: embedded app tier for host runtimes and app shells
- `sqlite`: default local portable backend
- `mongodb`: shared/team backend
- `embedded/mobile`: optional adapter for products that need local app integration

The three-tier compatibility model is:

1. embedded in-memory for app-hosted integration
2. local persistent SQLite for individual developer machines
3. shared MongoDB or another compatible database for multi-developer environments

## Deployment Guides

- Google Cloud Run + MongoDB: `docs/cloud-run-mongodb.md`
- Cache policy and usage: `docs/cache-policy.md`
- Ops metrics and effectiveness loop: `docs/ops-metrics.md`
- Developer quickstart: `docs/developer-quickstart.md`

## MCP Direction

MemFlow MCP is planned as a new, minimal FastMCP-based server.

The existing custom MCP implementation in this repository may provide reference utilities, but it is not the target architecture for the MemFlow product.

## Planned Surface Area

### Keep

- memory store/search/retrieve/list/delete
- import/export/merge
- legacy RuFlo detection/import
- first-party ingestion plugin support
- namespace and project scoping
- prompt-cache primitives
- embeddings/search over structured coding knowledge
- automatic recovery, recall, prompt-cache reuse, and compaction through host lifecycle hooks

### Remove

- chat UI
- model routing
- agent spawning
- swarm orchestration
- browser tools
- shell execution tools
- dynamic user-added MCP servers
- incomplete or aspirational product claims

## Legacy Import

MemFlow can detect and import a prior local RuFlo setup:

```bash
npm run migrate:ruflo
```

Current behavior:

- walks upward from the current working directory
- detects `.swarm/memory.db`
- detects `.claude/memory.db`
- detects `.claude-flow/`
- imports legacy `memory_entries`
- imports legacy `patterns`
- stores a legacy setup snapshot for migration provenance

## Automatic Operation

MemFlow can be configured during `init` to enable:

- prior-state recovery
- semantic memory recall
- automatic prompt caching
- session compaction
- live activity and savings monitoring

Installation configures these features locally. They become truly automatic when the host client calls:

- `agent:prepare` before a turn
- `agent:finalize` after a turn

Useful operator commands:

```bash
memflow status
memflow metrics --days 7
memflow savings --detailed --project my-project --repo my-repo
memflow recover --sessionId active
memflow recall --text "stale auth cache"
memflow agent:prepare --supplier claude
```

## Versioning

Human-readable version output:

```bash
memflow version
```

Machine-readable version output:

```bash
memflow version --json
```

Version metadata can surface GitHub release context through:

- `GITHUB_REF_NAME`
- `GITHUB_SHA`
- `GITHUB_REPOSITORY`



## Documents

- [ABOUT.md](./ABOUT.md) — what MemFlow is, who it's for, and how it works
- [SPEC.md](./SPEC.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [MCP.md](./MCP.md)
- [CONNECTORS.md](./CONNECTORS.md)
- [SECURITY.md](./SECURITY.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [RELEASE.md](./RELEASE.md)
- [docs/ag-bridge.md](./docs/ag-bridge.md)
- [docs/mobile-bridge-pattern.md](./docs/mobile-bridge-pattern.md)
- [docs/claude-code-adoption.md](./docs/claude-code-adoption.md)
- [docs/codex-mcp-adoption.md](./docs/codex-mcp-adoption.md)
- [docs/vscode-mcp-adoption.md](./docs/vscode-mcp-adoption.md)
- [docs/chatgpt-openai-desktop.md](./docs/chatgpt-openai-desktop.md)
- [docs/trust-model.md](./docs/trust-model.md)
- [docs/local-first-scaling.md](./docs/local-first-scaling.md)
- [docs/developer-quickstart.md](./docs/developer-quickstart.md)
- [docs/startup-audit.md](./docs/startup-audit.md)
- [docs/import-export-examples.md](./docs/import-export-examples.md)
- [docs/openclaw-mcp-setup.md](./docs/openclaw-mcp-setup.md)
