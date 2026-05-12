# Claude Code Adoption Guide

This guide explains how to integrate MemFlow with Anthropic's Claude Code via the Model Context Protocol (MCP). MemFlow operates entirely locally until configured otherwise, acting as an intelligent memory broker.

## Automatic Installation

MemFlow includes a one-shot guided installation process. From your project root, run:

```bash
npx memflow connect:claude-code
npx memflow connect:claude
```

MemFlow will detect your shell environment, initialize `.memflow` configuration, and patch the `claude.json` configuration file to mount the MemFlow server.
After install, the CLI tells you whether MemFlow is on and connected or whether Claude Code needs a reload before the connection is live.

## What to Expect

Once installed, Claude Code will automatically invoke the following tools:
- `mcp_memflow_memory_agent_prepare`: Triggered at the beginning of a session to load relevant profiles and history.
- `mcp_memflow_memory_agent_finalize`: Triggered automatically to save checkpointing data when an objective is reached.
- `mcp_memflow_memory_cache_auto_get`/`store`: Resolves prompt-cache fingerprints.

**Zero Configuration needed:** Claude Code interprets these tools natively and you will see "MemFlow" appearing in the MCP capabilities list.
