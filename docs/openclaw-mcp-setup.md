# MemFlow™ for OpenClaw — Setup Guide

## Quick Setup (2 minutes)

### Prerequisites
- OpenClaw installed and running (`openclaw --version`)
- MemFlow installed globally (`npm install -g memflow` or `npm link` from source)
- MemFlow initialized (`memflow init`)

### Register MemFlow as MCP Server

```bash
openclaw mcp set memflow '{"command":"memflow","args":["mcp"]}'
```

Verify:
```bash
openclaw mcp list
# Should show: memflow

openclaw mcp show memflow --json
# Should show: {"command":"memflow","args":["mcp"]}
```

### Tool Availability

Once registered, OpenClaw agents have access to all 29 MemFlow tools, namespaced under `memflow.*`:

| Tool | Purpose |
|---|---|
| `memflow.memory_store` | Store structured knowledge |
| `memflow.memory_search` | Semantic search across all memory |
| `memflow.memory_retrieve` | Get a specific entry by ID |
| `memflow.memory_list` | Browse entries with filters |
| `memflow.memory_cache_auto_get` | Automatic prompt cache lookup |
| `memflow.memory_cache_auto_store` | Automatic prompt cache write |
| `memflow.memory_agent_prepare` | Pre-turn recovery and context loading |
| `memflow.memory_agent_finalize` | Post-turn checkpointing and compaction |
| `memflow.memory_pattern_promote` | Promote verified fixes to reusable patterns |
| `memflow.memory_session_resume` | Resume from last session checkpoint |
| `memflow.memory_profile_load` | Load persona/profile blocks |
| `memflow.memory_metrics` | Operational metrics and savings |

### Remote / Team Setup

For shared team access via HTTP stream:

```bash
# Start MemFlow MCP on HTTP (on a team server or locally)
memflow mcp --transport httpStream --port 8080

# Register in OpenClaw with HTTP transport
openclaw mcp set memflow '{"url":"http://localhost:8080/mcp","transport":"streamable-http"}'
```

For remote team servers:
```bash
openclaw mcp set memflow '{"url":"https://memflow.your-team.com/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer <token>"}}'
```

### Verify Connection

```bash
# Check MemFlow status
memflow status

# Should show connected connector (SQLite or MongoDB)
```

## Notes

- OpenClaw's built-in `memory-core` plugin registers `memory_search` and `memory_get` tools. MemFlow's tools are MCP-namespaced as `memflow.memory_search` etc., so there is **no collision**.
- MemFlow MCP uses stdio transport by default (spawned as a child process). OpenClaw manages the lifecycle automatically.
- MemFlow's MCP surface uses a **fixed tool allowlist** — no dynamic tool injection risk.
- MongoDB credentials are never stored in OpenClaw config; they live in MemFlow's `~/.memflow/config.json`.
