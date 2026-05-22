# About MemFlow™

## What Is MemFlow?

**MemFlow™** is a portable, local-first memory layer for AI coding agents.

It gives coding agents — running in IDEs, terminals, CI pipelines, or headless
servers — a consistent place to store, retrieve, and share structured knowledge
across sessions. Without MemFlow, each agent session starts from scratch. With
MemFlow, agents can recall prior decisions, reuse cached prompts, and pick up
where they left off.

MemFlow is intentionally narrow. It stores memory. It does not orchestrate
agents, run code, or automate workflows. Its value is reliability and portability:
the same memory layer works across SQLite (local), MongoDB (team), and embedded
(app-hosted) environments, with the same schema, the same merge behavior, and
the same MCP surface in each.

---

## Who Is It For?

| Audience | How They Use MemFlow |
|---|---|
| **Individual developers** | Persistent local coding context across sessions, prompt cache reuse, and session recovery |
| **Teams** | Shared structured memory across developers via MongoDB, with deterministic merge and provenance |
| **AI agent builders** | A safe, fixed MCP surface to plug into any agent that supports the Model Context Protocol |
| **Mobile bridge users** | Headless mobile-to-agent communication via the `ag_bridge` pattern — no CDP or Accessibility permissions |
| **App and product developers** | An embeddable in-memory tier for hosting agent memory inside an application shell |

---

## Core Features

### Memory CRUD
Store, search, retrieve, list, and delete structured memory entries scoped by
namespace, project, repository, and workspace. All entries carry provenance,
confidence, and freshness metadata.

### Prompt Cache
Store and retrieve reusable prompt fragments keyed by task or content hash.
Reduces repetitive token cost for common patterns and boilerplate context.

### Session Checkpoint and Recovery
Agents can checkpoint their state at any milestone and resume from it later —
across restarts, host reloads, or context-window compaction cycles.

### Import / Export / Merge
Export memory as JSON, import it into any compatible MemFlow instance, and
merge records deterministically. Same behavior across SQLite and MongoDB.

### Security Sweep Engine
All write operations are scanned at the MCP boundary before persistence.
Detects private keys, API tokens, database credentials, and optionally PII.
Configurable as `warn`, `redact`, or `block`. Enabled by default.

### Mobile Bridge (ag_bridge)
Two dedicated MCP tools — `mobile_read_inbox` and `mobile_respond` — enable
headless communication between a mobile companion app and a local AI agent
through MemFlow's local SQLite database. No CDP port-sniffing, no Accessibility
permissions, no open IDE window required.

See [docs/ag-bridge.md](./docs/ag-bridge.md) for the full integration guide.

### Fixed MCP Tool Allowlist
MemFlow exposes a locked set of memory-only MCP tools. It does not expose
shell execution, browser automation, agent spawning, or dynamic tool routing.
The surface is small by design and reviewed on every release.

### Multi-Backend Support
- **SQLite** — default local backend, zero setup, portable
- **MongoDB** — shared team backend, same schema and merge behavior
- **Embedded in-memory** — for app-hosted or test environments

---

## What MemFlow Is Not

MemFlow is explicitly **not**:

- A chat UI or conversational AI product
- An agent orchestration framework
- A workflow automation engine
- A browser automation or shell execution tool
- A general-purpose MCP router or proxy
- A hosted cloud service (it runs locally; cloud deployment is optional for teams)

---

## How It Connects to Agents

MemFlow exposes its full feature set through the **Model Context Protocol (MCP)**.
Any agent that supports MCP can connect to MemFlow's local stdio server and
use all memory tools immediately.

Quick connect commands:

```bash
memflow connect:claude-code     # Claude Code
memflow connect:codex           # OpenAI Codex / Codex CLI
memflow connect:vscode          # VS Code agent chat
memflow connect:chatgpt         # ChatGPT / OpenAI desktop connector
memflow connect:antigravity     # Antigravity IDE
memflow connect:auto            # Install all supported hosts at once
```

---

## Architecture at a Glance

```
Your Agent (via MCP)
    ↓
MemFlow MCP Server  ──  Security Sweep  ──  Rate/Payload Guard
    ↓
MemFlow Core  (namespace routing, prompt cache, session, merge)
    ↓
Connector Layer
    ├── SQLite (~/.memflow/memflow.sqlite)
    ├── MongoDB (shared team instance)
    └── In-Memory (embedded / test)
```

---

## Quick Start

```bash
# Install
npm install -g memflow

# First-time setup (guided)
memflow init

# Check status
memflow status

# Connect your agent
memflow connect:claude-code
```

Full guide: [docs/developer-quickstart.md](./docs/developer-quickstart.md)

---

## Trademark and Attribution

`MemFlow` and `MemFlow™` are trademarks of dServices Limited, trading as CPUcoin.

MemFlow is part of the CPUcoin / equilibrium.com product ecosystem and the
broader **"The Hybrid Decentralized Cloud For AI"** platform direction.

---

## License

[MIT](./LICENSE)
