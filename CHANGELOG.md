# Changelog

All notable changes to MemFlow should be recorded in this file.

The format is based on Keep a Changelog and uses semantic versioning.

## [Unreleased]

### Added

- `mobile_read_inbox` MCP tool — reads pending messages from the `ag_bridge/inbox` namespace
- `mobile_respond` MCP tool — writes agent responses to the `ag_bridge/outbox` namespace
- `docs/ag-bridge.md` — full public documentation for the ag_bridge integration pattern, capability boundaries, and security model
- ag_bridge integration guidance in `docs/mobile-bridge-pattern.md` updated with MCP tool references

### Fixed

- `migration_export.json` was corrupted (contained CLI help output); replaced with empty `{}`

### Security

- Confirmed `migration_export.json` contains no private data
- `SECURITY.md` updated to include Security Sweep Engine documentation (runtime PII/key detection on all write tools)

## [1.0.0] - 2026-04-30

First stable release.

### Added

- embedded in-memory tier for app-hosted integration
- three-tier compatibility across embedded, local SQLite, and shared database backends
- dependency-linked invalidation and validation workflow
- workflow ingestion and pre-flight surfacing
- snippet alias support over the semantic retrieval layer
- expanded MCP integration roadmap and next-sprint planning

### Verified

- build and full test suite
- embedded connector mode
- snippet alias normalization
- dependency warnings on retrieval
- workflow pre-flight routing
- CLI validation and workflow ingestion commands

## [0.10.0] - 2026-04-05

Initial private testing release.

### Added

- memory-only FastMCP server
- SQLite connector
- MongoDB connector
- deployment-scope connector helper
- legacy RuFlo detection/import utility
- version-aware CLI
- release-check workflow

### Verified

- SQLite connector CRUD/search/export/diff/delete
- namespace isolation
- request guard limits
- localhost-default MCP behavior
- legacy RuFlo import
- version reporting
- package dry-run
