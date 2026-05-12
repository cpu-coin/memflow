# MemFlow Source Layout

Current source layout for the initial pruned MemFlow package:

- `src/core`
- `src/connectors`
- `src/mcp`
- `src/types`

Implemented in this first pass:

- reduced memory types and query builder
- connector contracts plus real SQLite and MongoDB connectors
- memory service boundary for CRUD/import/export/merge/diff/stats
- FastMCP server scaffold with a fixed memory-only tool allowlist
- request guard for size and rate limits

Not implemented yet:

- deployment-scoped Firebase/user connector
- deterministic merge engine
- bundle diff implementation
- integration tests

No legacy source files should be copied here until they are explicitly approved in `FILE-INVENTORY.md`.
