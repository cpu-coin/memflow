# VS Code MCP Adoption Guide

This guide explains how to connect MemFlow to Visual Studio Code using the standard MCP workspace configuration.

## Automatic Installation

From the root of your workspace:

```bash
npx memflow connect:vscode
```

MemFlow will install or update the workspace `.vscode/mcp.json` file with a `memflow` MCP server entry that points at the local MemFlow runtime.
Once the workspace reloads, MemFlow should show as on and connected in the status line.

## Manual Installation

If you prefer to manage the file yourself, add a `memflow` server under `servers` in `.vscode/mcp.json`:

```json
{
  "servers": {
    "memflow": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/mcp/server.js", "--config", ".memflow/config.json"]
    }
  }
}
```

## Validation

Run the host validation command to confirm the VS Code workspace file exists and the MemFlow server entry is present:

```bash
npx memflow validate:host --host vscode
```

## Reload

After installation, reload the VS Code workspace so the new MCP server is discovered.
