# MemFlow MCP

## Direction

MemFlow MCP will use a minimal FastMCP-based server.

This is a deliberate product decision:

- smaller server surface
- easier auditing
- clearer plugin boundaries
- less legacy orchestration residue
- easier connector integration

## Why Not Reuse the Legacy MCP Server

The existing MCP implementation in this repository is a broader custom framework with:

- custom transports
- connection pooling
- prompt/resource/task registries
- generalized server capabilities

That is useful reference material, but it is not aligned with the MemFlow product goal of a narrow, memory-only, low-risk MCP endpoint.

## MemFlow MCP Scope

MemFlow MCP is only responsible for:

- exposing memory-only tools
- validating requests
- enforcing scope and limits
- calling MemFlow Core
- surfacing health/stats for operators

Initial scaffold status:

- FastMCP server scaffold exists in `src/mcp/server.ts`
- tool registration exists in `src/mcp/tools.ts`
- request rate and payload guards exist in `src/mcp/guard.ts`

## Planned Tool Allowlist

- `memory_store`
- `memory_search`
- `memory_retrieve`
- `memory_list`
- `memory_delete`
- `memory_import`
- `memory_export`
- `memory_merge`
- `memory_diff`
- `memory_stats`

## Disallowed Behavior

- arbitrary tool routing
- dynamic third-party MCP mounting
- shell execution
- browser automation
- workflow execution
- agent orchestration
- generalized provider access

## Connector Model

Connectors may feed MemFlow MCP, but only through approved internal contracts.

Example acceptable pattern:

`connector -> normalize/validate -> MemFlow Core -> storage connector`

Example unacceptable pattern:

`MemFlow MCP -> arbitrary external MCP passthrough -> unknown tools`

## Review Standard

No MCP tool should exist in MemFlow unless:

- it supports the memory-only product scope
- it has a documented schema
- it has tests
- it passes the security model
