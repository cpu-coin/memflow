# Codex MCP Adoption Guide

This guide explains how to connect MemFlow to the Codex IDE extension using the standard Model Context Protocol.

## Automatic Installation

MemFlow includes native Codex bootstrapping. From the root of your project:

```bash
npx memflow connect:codex
npx memflow connect:openai
```

This will automatically locate your IDE's global MCP settings (or workspace `.vscode/settings.json`) and append the `memflow` process as an execution target.
After install, MemFlow reports whether it is already on and connected or whether the IDE needs a reload first.

## Manual Installation

If your IDE prevents automatic appending, you can add MemFlow to your Codex settings manually:

```json
{
  "mcpServers": {
    "memflow": {
      "command": "npx",
      "args": ["memflow", "mcp"]
    }
  }
}
```

## Validation

Run `npx memflow validate:host --host codex` to verify Codex is properly pointing to the MemFlow binary and isn't generating malformed JSON requests.

If you are using Visual Studio Code directly, see the VS Code adoption guide in `docs/vscode-mcp-adoption.md`.
