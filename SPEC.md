# MemFlow v1 Spec

## Summary

MemFlow is a memory-only MCP product for coding agents. It provides portable shared knowledge, prompt caching, session recovery primitives, hybrid structured plus vector-ready retrieval, and deterministic import/export/merge across supported storage backends.

The product is intended to remain useful even as major model vendors expand their own built-in orchestration features. MemFlow focuses on the durable gap: shared, persistent, secure local code memory.

## Founding Context

MemFlow is specified as a focused infrastructure spoke within the broader CPUcoin / equilibrium.com product direction.

That broader direction begins with:

> The Hybrid Decentralized Cloud For AI

This spec keeps MemFlow intentionally narrow inside that larger platform vision: persistent memory, shared knowledge, prompt caching, and safe local-first deployment.

## Goals

- make cross-session coding memory easy to adopt
- make shared team knowledge portable and mergeable
- make memory access available through a small MCP interface
- support local-only and shared-team deployments with the same logical model
- make local-first installation simple, explicit, and trustworthy
- reduce repeated prompt and setup costs by preserving validated context
- make semantic recall work across changing wording without giving up deterministic storage
- reduce attack surface compared with the broader `claude-flow` product

## Non-Goals

- no chat interface
- no autonomous multi-step execution
- no shell execution
- no browser automation
- no agent lifecycle management
- no swarm orchestration
- no dynamic third-party tool registration
- no background provider-cost loops

## Core Capabilities

### Memory Operations

- `memory_store`
- `memory_search`
- `memory_retrieve`
- `memory_list`
- `memory_delete`

### Automation Operations

- `memory_init`
- `memory_profile_store`
- `memory_profile_load`
- `memory_session_checkpoint`
- `memory_session_resume`
- `memory_session_compact`
- `memory_pattern_promote`
- `memory_sync_plan`
- `memory_sync_export`

### Sync Operations

- `memory_import`
- `memory_export`
- `memory_merge`
- `memory_diff`

### Prompt Cache Operations

- exact cache lookup
- automatic prompt fingerprint lookup
- compacted session cache lookup
- cache store
- cache invalidation by project or schema version

### Local Adoption Operations

- guided local-first install
- tracked project discovery under a projects root
- tracked project enable/disable registry
- local doctor/status inspection
- local operational metrics for cache reuse, checkpointing, compaction, and agent activity

### Connector Support

- controlled ingestion connectors
- controlled sync/export connectors
- fixed internal connector contract
- no arbitrary MCP passthrough

### Legacy Migration

- detect prior local RuFlo setup
- import legacy memory entries into MemFlow
- import legacy learned patterns into MemFlow
- preserve a setup snapshot for provenance and auditability

## Storage Contract

All backends must provide:

- stable logical schema
- deterministic read/write behavior
- schema versioning
- namespace isolation
- project scoping
- import/export compatibility
- merge support
- provenance fields

MemFlow v1 retrieval must follow a hybrid model:

- structured records remain the canonical source of truth
- embeddings are a derived index, not the authoritative record
- exact key and scoped lookup remain available
- semantic retrieval may use local or managed vector infrastructure without changing the logical entry format

MemFlow v1 deployment must support a clear scale path:

- optional ephemeral demo mode
- embedded in-memory app tier
- default durable local mode with SQLite
- shared-team mode with MongoDB
- later managed service mode without changing the logical model

## Preferred Backends

MemFlow must remain compatible with three deployment tiers:

1. Embedded in-memory tier for app-hosted integration, such as an AI hub shell or another product runtime.
2. Local persistent tier for a single developer machine, using SQLite by default.
3. Shared multi-developer tier for teams or centralized deployment, using MongoDB or another compatible database.

The same logical memory model must survive across all three tiers. Only the persistence and hosting mechanics are allowed to differ.

### SQLite

- default backend
- easiest local adoption
- portable file-based distribution
- good fit for solo developers and CI-local workflows
- default path under `~/.memflow/memflow.sqlite` unless explicitly overridden

### MongoDB

- team/shared deployment backend
- useful for centralized local-network or shared-dev workflows
- must obey the same logical MemFlow schema
- may later host a managed vector index beside the canonical collection

### Embedded/Mobile Adapter

- optional backend for embedding in adjacent products
- same MemFlow API, same import/export contract

### In-Memory

- embedded app tier for in-process use
- appropriate for products that want MemFlow as part of the app shell
- should share the same entry model, provenance rules, and retrieval behavior as the persistent tiers
- should remain deterministic for tests and local app integration, even if persistence is ephemeral

## Memory Entry Shape

Each stored entry should include at minimum:

- `id`
- `namespace`
- `project_id`
- `kind`
- `title`
- `content`
- `tags`
- `source`
- `provenance`
- `confidence`
- `created_at`
- `updated_at`
- `last_verified_at`
- `schema_version`
- `embedding_version`
- `content_hash`

Embeddings are optional at rest but strongly recommended for:

- `pattern`
- `knowledge`
- `persona`
- `workflow`
- compacted `session` cache entries

Session checkpoints remain structured-first and do not need to be vector-indexed by default.

## Namespacing

Required scopes:

- organization/team
- project
- repository
- session
- workspace
- user-private overlay

## Merge Behavior

MemFlow must support deterministic merge with:

- provenance retention
- content-hash deduplication
- conflict reporting
- tombstones for deletes
- merge summaries

## Retrieval Behavior

MemFlow v1 retrieval should be hybrid:

- exact lookup first
- scoped structural filtering second
- semantic similarity over derived embeddings third
- small ranked result sets returned to the caller

MemFlow must not treat vector similarity as a replacement for:

- namespace isolation
- scope filters
- deterministic prompt-cache keys
- explicit session recovery records

## MCP Surface

Only memory-only MCP tools are allowed in v1.

No execution, orchestration, browser, or generalized external tool operations may be exposed.

MemFlow v1 should use a minimal FastMCP-based server rather than inheriting the broader custom MCP framework from the legacy codebase.

## Product Surfaces

MemFlow should remain headless-first.

Primary surfaces in v1:

- CLI
- MCP server
- local config and status commands

External product shells are expected to integrate with MemFlow rather than be embedded into MemFlow core.

MemFlow must still remain compatible with embedded in-memory use inside another product runtime when the host app wants MemFlow as a library or local service component.

Priority integration direction:

- CPUcoin dashboard as the primary product shell
- Vibecraft as an early workflow client

## MemFlow Enhancement Spec: Next Sprint

This section turns the requested enhancement set into a concrete MemFlow sprint plan. It is intentionally mapped onto the current MemFlow feature set so the implementation can reuse existing primitives instead of creating a parallel product model.

### Current Feature Mapping

- Default auto-pattern persona distribution maps onto the existing `memory_init`, `memory_profile_store`, `memory_agent_prepare`, `memory_agent_finalize`, and `memory_pattern_promote` flow.
- Semantic snippet RAG maps onto the existing hybrid retrieval layer and the `rag` memory kind. `snippet` should be treated as a user-facing alias or ingestion label until a migration is justified.
- First-class workflow encoding maps onto the existing `workflow` memory kind and the generated workflow entries created during init and host bootstrap.
- Dependency-linked invalidation maps onto the existing cache invalidation and schema-versioning model, but it needs dependency fingerprinting and major-version warnings to become useful in practice.

### Product Split

MemFlow should keep two explicit tracks in the next sprint:

- Internal/private-preview track: host hooks, safety validation, dependency invalidation, seeded personas, and CI-level verification.
- Public-launch track: installer flows, docs, examples, semantic recall, workflow ingestion, and safe default integration bundles for any MCP-capable client.

The public product should never expose a weaker model than the private one. The private track can add automation earlier, but the public track must still inherit the same storage schema, warnings, and safety checks.

### Feature 1: Default Auto-Pattern Persona Distribution

Goal:

- seed a reusable persona that pushes verified fixes into `memory_pattern_promote` without requiring the user to remember the command name
- make the behavior available through CLI init, host bootstrap, and MCP-facing guidance

Technical design:

- Keep the canonical MCP tool name as `memory_pattern_promote` in the core server.
- Add host-level aliases and prompt text that can reference the tool in a host-native way, including `mcp_memflow_memory_pattern_promote` for surfaces that want the prefixed naming convention.
- Add an opt-in global or workspace-level profile generated during `memflow init`.
- The seeded persona should make the pattern-promotion requirement explicit for recurring bugs, environment traps, and multi-attempt fixes.
- The MCP server should surface pattern promotion guidance in session-finalization and long-running session summaries.

Verification:

- add tests for seeded persona creation
- add tests for host bridge generation and managed-rule injection
- add tests for finalization output that includes a pattern-promotion reminder when the session shows repeated failures or compaction

### Feature 2: Semantic Snippet RAG

Goal:

- reduce token waste by returning canonical, validated code snippets instead of re-inventing UI or logic blocks

Technical design:

- Keep `rag` as the canonical storage kind for semantic code memory.
- Add a `snippet` ingestion and UI label that normalizes to `rag` or `knowledge` based on whether the payload is code-like or explanatory.
- Store the snippet payload with tags for framework, component, platform, and approval state.
- Use the existing embedding layer to rank snippet-like entries by implementation similarity.
- Expose a code-focused search path that can prefer HTML, CSS, SCSS, TypeScript, or shell blocks with the highest-confidence match.
- Add an IDE command for highlighting code and sending it to MemFlow as a snippet.

Verification:

- add tests for snippet normalization and metadata tagging
- add tests for semantic search ranking over code-like payloads
- add tests that a snippet import round-trips through export and merge without losing provenance

### Feature 3: First-Class Workflow Encoding

Goal:

- make workflow runbooks queryable, structured, and automatically discoverable before an agent takes action

Technical design:

- Keep `workflow` as a first-class memory kind.
- Add `memflow ingest workflows` to convert markdown runbooks into structured workflow entries.
- Parse headings, ordered steps, shell blocks, prerequisites, and notes into a normalized workflow payload.
- Add semantic routing so user prompts like "deploy to staging" can surface the relevant workflow before execution begins.
- Make the pre-flight context include the workflow plus its exact shell instructions, but do not allow workflow text to widen the MCP tool surface.

Verification:

- add tests for markdown-to-workflow ingestion
- add tests for workflow discovery from intent-like queries
- add tests that the resulting pre-flight payload is stable and deterministic

### Feature 4: Automated Dependency-Linked Invalidation

Goal:

- prevent stale patterns, snippets, or workflows from being reused when the workspace dependency graph has changed

Technical design:

- Capture dependency fingerprints from `package.json`, `Podfile`, `build.gradle`, or equivalent project manifests at write time.
- Store the major versions as tags and metadata on knowledge, pattern, snippet, and workflow entries.
- Add `memflow validate` to compare the current workspace dependency snapshot against stored tags.
- Flag, archive, or deprecate entries when a major version mismatch is detected.
- When a flagged entry is retrieved, include a warning that names the dependency and the version drift.

Verification:

- add tests for dependency fingerprint extraction
- add tests for mismatch warning text
- add tests for archive or deprecation behavior on major-version bumps

### Integration Surface

MemFlow should treat "MCP-capable" as the baseline integration contract. The next sprint should produce default bundles and docs for a broad set of surfaces, grouped as follows:

- IDEs and editor shells: Cursor, VS Code, Continue, JetBrains clients through Continue, Claude Code, Claude Desktop, Antigravity, Windsurf, Sourcegraph Cody, Cline, and any other MCP-capable editor that can consume a JSON, TOML, or YAML config block.
- CLI agents: MemFlow CLI, OpenAI Codex CLI, and other terminal-first MCP clients that can load a server entry.
- AI app surfaces: OpenAI ChatGPT / Apps SDK code-mode surfaces, Claude.ai / Claude Desktop code-mode surfaces, remote MCP connectors, and local bundle flows where supported.
- Packaging and directory targets: MCP Registry, GitHub MCP Registry, Smithery, Docker MCP Catalog, ToolHive, MCPBundles, Glama, PulseMCP, mcp.so, Cline Marketplace, and other submission endpoints used for discoverability.
- CI and automation: GitHub Actions, GitLab CI, CircleCI, Buildkite, Jenkins, and Azure DevOps, with smoke checks for `memflow validate`, `memflow status`, and `memflow metrics`.

The important distinction is that the product should not hard-code each host separately. It should generate a small set of canonical config fragments and then adapt them to the target surface.

### Automated Testing

The next sprint should add and keep these automated checks:

- schema tests for the memory model, dependency metadata, and kind normalization
- MCP tool contract tests for request validation, guardrails, and warning surfaces
- host integration tests for generated configs and lifecycle bridges
- CLI smoke tests for init, validate, status, and metrics
- retrieval tests for semantic snippet ranking and workflow lookup
- regression tests for stale-version warnings and pattern promotion guidance

Test strategy:

- SQLite remains the default fast path for unit and integration tests.
- MongoDB coverage should remain a separate integration lane.
- Any tests that depend on external services or host CLIs should be gated behind environment checks so the default test run stays deterministic.

### Next Sprint Definition Of Done

- the core schema supports the mapped feature set without breaking current memory kinds
- the public spec describes the new behavior clearly enough for external adopters
- the private roadmap tracks implementation, verification, and rollout tasks separately
- generated host or IDE bundles work for at least one representative example in each major integration class
- the test suite covers the new metadata, warnings, and discovery flows

## Guided Install Expectations

The default install path should:

- explain what data is stored and why
- default to local durable storage
- discover candidate git repositories from a user-selected projects root
- let the user choose which projects are tracked automatically
- make private vs shared behavior explicit before team sync is enabled
- backfill local embeddings for imported and existing records so semantic recall works immediately after setup

## Deferred Trust Layer

MemFlow v1 should preserve provenance fields internally and leave room for a future optional provenance adapter that can sign or externally anchor high-value session and promotion events.

## Vector Index Strategy

MemFlow v1 should support a clear vector evolution path:

- local deterministic embeddings for immediate semantic recall in localhost-first installs
- optional shared vector indexing beside Mongo-backed team memory
- later managed vector infrastructure without changing the core memory schema or MCP interface

## Release Criteria

Before public release:

- all exposed MCP tools are documented and tested
- all old high-risk features are absent, not merely hidden
- import/export/merge is deterministic across supported backends
- localhost-default deployment is verified
- dependency and secret scans pass
- remnant audit passes

## Deferred Integrations

Product-specific integrations should remain outside the MemFlow core spec and live in separate documents or repositories until the core product is stable.

## Attribution Guidance

Public-facing MemFlow materials should, where appropriate, acknowledge that:

- MemFlow sits within the CPUcoin / equilibrium.com ecosystem
- dServices Limited, trading as CPUcoin, is the intended product steward
- the product is one spoke in the larger "The Hybrid Decentralized Cloud For AI" platform direction
