# Database Connectors

## Purpose

MemFlow uses database connectors so the product stays portable while preserving a single logical memory model.

The connector layer exists to support different deployment environments without changing:

- the MemFlow schema
- MCP tool behavior
- import/export format
- merge semantics
- provenance and trust rules

## Initial Connector Targets

### SQLite Connector

- default local portable backend
- file-based setup for easiest adoption
- deterministic local development and backup flows

### MongoDB Connector

- shared/team backend
- useful for centralized development memory
- same MemFlow schema and merge behavior as SQLite

### User-Scoped Firebase/Mongo Deployment Connector

- deployment-specific connector shape for user-scoped memory
- must still resolve to the canonical MemFlow storage contract
- tenancy, namespace, and provenance rules must be preserved
- deployment scoping must happen before shared writes are committed
- user-private and shared scopes must remain distinct

### Embedded Connector

- optional adapter for embedding MemFlow into adjacent products
- same logical MemFlow API, different runtime persistence details

## Connector Contract

Every connector must implement:

- `init`
- `health`
- `read`
- `write`
- `delete`
- `search`
- `list`
- `export`
- `import`
- `merge`
- `migrate`

## Deployment-Scoped Connector Shape

Deployment-scoped connectors are allowed when a product needs tenant or user isolation on top of the core MemFlow schema.

Requirements:

- resolve tenant, user, repo, project, and workspace coordinates before writes
- preserve the canonical MemFlow entry shape
- reject writes when required deployment scope is missing
- keep user-private memory separate from shared memory
- avoid product-specific policy logic inside MemFlow core

Reference implementation boundary:

- `src/connectors/deployment.ts`

## Connector Rules

- connectors may optimize storage/indexing internally
- connectors may not change the MemFlow logical schema
- connectors may not bypass validation or provenance requirements
- connectors may not expose extra risky capabilities through MCP
- in-memory implementations are test-only and not a production connector

## First-Party Ingestion Plugin

MemFlow also supports controlled ingestion plugins that normalize external content into the canonical memory write contract before persistence.



Rules:

- plugin inputs must be validated before any write
- plugins must emit canonical `MemoryWriteInput`
- plugins may not register arbitrary MCP tools
- plugin credentials must come from environment or runtime config, never committed values
- plugin output must preserve provenance identifying the plugin and upstream source

## Future Connector Notes

Connector-specific product integrations should stay outside the MemFlow core product spec and live in separate integration documents.
