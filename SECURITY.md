# MemFlow Security Model

## Security Posture

MemFlow is a reduced-scope local-first product. Its security comes from refusing to expose broad functionality.

## Required Defaults

- bind localhost by default
- fixed MCP tool allowlist
- no shell execution
- no browser automation
- no autonomous loops
- no dynamic remote MCP connectors
- strict schema validation on every write/import
- import/export audit trail

## Allowed MCP Tool Families

- memory CRUD
- prompt-cache read/write
- import/export/merge
- stats and health

## Disallowed Tool Families

- shell / terminal
- browser / web automation
- workflow execution
- swarm / hive / coordination
- agent spawn / stop / list
- arbitrary GitHub integration
- remote search / research / scraping
- code execution

## Threat Model Priorities

- accidental exposure of non-memory tools
- unbounded or recursive agent/tool loops
- hidden cost generation
- unsafe import payloads
- namespace escape between repos/teams
- stale or unverifiable memory poisoning

## Release Gate

MemFlow should not publish until these checks pass:

- MCP tool inventory reviewed
- dependency inventory reviewed
- remnant code scan completed
- secret scan completed
- import fuzz tests completed
- namespace isolation tests completed
- deterministic merge tests completed

## Trust Model

Shared memory entries must support:

- provenance
- confidence
- freshness
- source identification
- reversible export/import

MemFlow should prefer explicit trust signals over implicit magic.
