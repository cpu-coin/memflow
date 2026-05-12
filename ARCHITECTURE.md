# MemFlow Architecture

## High-Level Shape

```text
Agent / CLI / Dashboard Client
    -> MemFlow MCP or CLI
    -> MemFlow Core
    -> Derived Embedding / Hybrid Retrieval Layer
    -> Connector Layer
    -> In-Memory / SQLite / MongoDB-or-Other-DB Backends
    -> Optional Provenance Adapter
```

## Deployment Tiers

MemFlow must remain compatible with three deployment tiers:

### Tier 1: Embedded In-Memory

- intended for app embedding, such as an AI hub shell or other product runtime
- useful when MemFlow should ship inside an app process instead of as a separate daemon
- should keep the same logical memory model even when persistence is ephemeral or host-managed
- must support the same core APIs, but can omit disk persistence and external sync

### Tier 2: Local Persistent Database

- intended for a single developer machine or a small local workspace
- default implementation is SQLite under `~/.memflow`
- should preserve deterministic import/export, merge, and retrieval behavior
- should be the easiest path for local-first adoption and testing

### Tier 3: Shared Multi-Developer Database

- intended for multiple developers, shared teams, or centrally managed workspaces
- supported through MongoDB today, with room for other compatible databases later
- should preserve the same logical schema, provenance, and retrieval semantics
- should support the same public APIs as the embedded and local tiers

## Platform Context

MemFlow is one focused subsystem in the broader CPUcoin / equilibrium.com platform direction.

That larger platform direction begins with:

> The Hybrid Decentralized Cloud For AI

Architecturally, that means MemFlow should remain a narrow memory and knowledge component that can plug into adjacent products without inheriting broader orchestration or execution scope.

CPUcoin dashboard is the intended primary product shell. Vibecraft is an early integration client, not a MemFlow runtime dependency.

## Modules

### MemFlow Core

Responsibilities:

- canonical data model
- namespace/project scoping
- prompt-cache and compaction logic
- profile and tracked-project logic
- session checkpoint and resume
- pattern promotion and sync planning
- hybrid search orchestration
- local embedding generation and vector-ready indexing
- import/export/merge logic
- schema versioning and migrations

### MemFlow MCP

Responsibilities:

- expose the fixed memory-only MCP tool allowlist
- validate inputs
- enforce scope and limits
- translate MCP calls into MemFlow Core operations

Implementation direction:

- use FastMCP as the MemFlow MCP harness
- keep the server thin
- keep business logic in MemFlow Core
- avoid inheriting the legacy full-framework MCP surface

The CLI is equally important for v1 because it owns:

- guided install
- local project discovery
- local config management
- operator-facing health and status commands

### Connector Layer

Responsibilities:

- implement the MemFlow storage contract
- preserve deterministic behavior
- handle backend-specific indexing and persistence details
- host controlled ingestion/sync connectors that map into MemFlow Core

Expected scale path:

- ephemeral demo mode
- durable local SQLite
- shared MongoDB
- derived local vector index / embeddings
- optional shared vector index beside MongoDB
- later managed service adapter

## Security Boundary

The MCP server is an interface boundary, not a feature-expansion point.

MemFlow MCP must not:

- execute shell commands
- browse the web
- spawn agents
- dynamically attach external MCP servers
- call arbitrary provider or workflow tools
- act as a generic tool router

## Extraction Source

The most likely reusable source areas in this repo are:

- `v3/@claude-flow/memory`
- selected small utility patterns from `v3/@claude-flow/mcp`

The old `ruflo/src/ruvocal` tree is not a dependency target for the MemFlow product. It is useful only as a reminder of what should be removed from scope.

## Backend Strategy

- embedded backend: in-memory for app integration and lightweight host embedding
- default backend: SQLite for local persistent use
- shared backend: MongoDB for multi-developer or centralized use
- optional adapter: embedded/mobile local DB
- additional compatible databases may be added later if they preserve the same logical contract

The backend selection must never change the logical MemFlow API or merge format.

## Retrieval Architecture

MemFlow retrieval should use a layered model:

- canonical structured records in SQLite or MongoDB
- derived embeddings attached to eligible records
- hybrid ranking in MemFlow Core

This keeps:

- exact prompt-cache keys deterministic
- session checkpoints inspectable
- semantic recall available without requiring a hosted vector dependency

Managed vector infrastructure can be added later, but it should remain a replaceable index layer rather than the primary database of record.

## Connector Boundary

MemFlow may support out-of-the-box connectors, but they must be constrained.

Allowed connector classes:

- ingestion connectors
- sync/export connectors
- backend connectors

Disallowed connector classes:

- arbitrary remote MCP proxying
- execution connectors
- browser connectors
- orchestration connectors

Connector-specific product integrations belong in separate integration documents, not in the MemFlow core product spec.

## Local-First Trust Model

MemFlow v1 should optimize for trust and inspectability:

- store local config under `~/.memflow/config.json`
- store the default SQLite database under `~/.memflow/memflow.sqlite`
- keep `session`, `cache`, `user`, and `workspace` memory local by default
- allow `project`, `repo`, and `team` memory to scale to a shared backend later
- make tracking opt-in and visible through CLI status surfaces

## Integration Boundary

Dashboard and orchestration products should consume MemFlow through stable interfaces rather than internal module coupling.

Priority integration targets:

- CPUcoin dashboard for the cross-platform product shell
- Vibecraft for early agent workflow validation

## Provenance Extension Point

MemFlow core should preserve provenance metadata now and leave a clean adapter boundary for optional high-trust signing or anchoring later.
