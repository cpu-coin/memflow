# AG Bridge — MemFlow Integration

`ag_bridge` is a LAN-only mobile companion server that allows users to send commands
to a local AI agent from their phone. MemFlow is the required infrastructure that
makes `ag_bridge` work reliably.

## Why MemFlow Is Required

Without MemFlow, mobile-to-agent communication requires:

1. Reverse-engineering Chrome DevTools Protocol (CDP) ports for the specific IDE version.
2. Granting broad macOS Accessibility permissions to inject keystrokes via AppleScript.
3. Keeping the IDE window open and visible at all times.

With MemFlow, none of that is needed. The mobile app and the local AI agent simply
read and write to the same local SQLite database (`~/.memflow/memflow.sqlite`).
The agent reads the inbox on its normal `memory_agent_prepare` cycle. No IDE, no
CDP port, no Accessibility permissions.

## Architecture

```
Mobile App (PWA)
    ↕ HTTP / WebSocket
ag_bridge Server (Node.js, LAN-only)
    ↕ Direct SQLite write (better-sqlite3)
~/.memflow/memflow.sqlite
    ↕ MemFlow MCP (memory_search / memory_store)
AI Agent (Antigravity, Claude Code, Codex, VS Code, etc.)
```

### Flow: Mobile → Agent

1. User sends a message from the mobile PWA.
2. `ag_bridge` writes it to `~/.memflow/memflow.sqlite` in the `ag_bridge/inbox` namespace with a `pending` tag.
3. The connected AI agent calls `mobile_read_inbox` (or `memory_search` with tag filter) to pick up the message.
4. The agent executes the requested task.

### Flow: Agent → Mobile

1. The agent calls `mobile_respond` with its reply.
2. MemFlow writes the response to the `ag_bridge/outbox` namespace with an `unread` tag.
3. `ag_bridge` polls the outbox every 5 seconds and broadcasts new responses to the mobile PWA via WebSocket.
4. The outbox entry is marked `read`.

## Required MCP Tools

MemFlow exposes two dedicated tools for the `ag_bridge` pattern:

| Tool | Description |
|---|---|
| `mobile_read_inbox` | Read `pending` messages from `ag_bridge/inbox`. Optionally filter by `project`. |
| `mobile_respond` | Write a response to `ag_bridge/outbox` with the `unread` tag. |

These tools are part of the standard MemFlow MCP tool allowlist. Any agent
connected to MemFlow via MCP has access to them automatically.

## Standard `memory_search` Alternative

If you prefer not to use the dedicated tools, you can use raw MemFlow primitives:

```jsonc
// Read inbox
{
  "tool": "memory_search",
  "args": { "query": "", "namespace": "ag_bridge/inbox", "tags": ["pending"] }
}

// Write response
{
  "tool": "memory_store",
  "args": {
    "key": "ag_bridge/outbox/resp_001",
    "content": "Done! The tests are passing now.",
    "coordinates": { "namespace": "ag_bridge/outbox", "scope": "workspace" },
    "tags": ["agent-response", "unread", "ag_bridge"]
  }
}
```

## Namespaces

| Namespace | Direction | Tag Convention |
|---|---|---|
| `ag_bridge/inbox` | Mobile → Agent | `pending` → `read` |
| `ag_bridge/outbox` | Agent → Mobile | `unread` → `read` |

## Security Considerations

- `ag_bridge` runs LAN-only and is not exposed to the public internet.
- All reads and writes go through `~/.memflow/memflow.sqlite` — a local file with standard macOS file-system permissions.
- MemFlow's built-in security sweep runs on all `memory_store` writes, detecting and optionally blocking private keys, API tokens, and PII before they are persisted.
- No CDP ports, no Accessibility permissions, no open network sockets to external services.
- The `ag_bridge` server should be run on a trusted LAN. Do not expose it to the internet without authentication.

## Setup: Enabling the ag_bridge Pattern

### 1. Install and initialize MemFlow

```bash
npm install -g memflow   # or: npm link from source
memflow init
```

### 2. Connect your agent to MemFlow MCP

Run `memflow connect:antigravity` (or `connect:claude-code`, `connect:codex`, etc.)
to install the MemFlow MCP server into your agent's configuration.

### 3. Start ag_bridge

```bash
# In the ag_bridge project directory
node server.mjs
```

The server will print a QR code and LAN URL. Open it on your phone.

### 4. Send a command from mobile

Type a message in the mobile PWA. The `ag_bridge` server writes it to MemFlow.
Your agent (if idle and checking its inbox) will pick it up on the next
`memory_agent_prepare` call, or immediately if it is using `mobile_read_inbox` directly.

## ag_bridge Capability Boundaries

`ag_bridge` is a **remote control** for your local agent. It does not:

- Execute code directly
- Have access to your file system independently
- Connect to external APIs
- Spawn sub-agents
- Bypass MemFlow's security sweep

All actual work is performed by the AI agent connected to MemFlow via MCP. `ag_bridge`
is strictly a communication bridge — it moves messages in and out of MemFlow, nothing more.

## Community Implementations

- [Damn Antigravity IDE Migrator](./community/antigravity-ide-migrator-macos/README.md) — community tool for migrating Antigravity workspaces (referenced in the MemFlow community folder)

## Related Documents

- [Mobile Bridge Pattern](./mobile-bridge-pattern.md) — general pattern documentation
- [MCP.md](../MCP.md) — full MemFlow MCP tool reference
- [SECURITY.md](../SECURITY.md) — MemFlow security model and sweep engine
- [ARCHITECTURE.md](../ARCHITECTURE.md) — system architecture and deployment tiers
