# MemFlow Trust Model

MemFlow is designed as a *Local-First* memory broker. It operates on the principle that context should remain on the device where it is processed unless explicitly pushed to a shared context model.

## 1. Local-First Isolation

By default, running `npx memflow init` generates a local SQLite database stored in `~/.memflow`. 
- No network requests are made outside of the MCP connection to your local AI Agent.
- Vector indexing happens purely locally using lightweight embeddings models.
- The boundary of memory sharing is limited strictly to local workspaces tracked via `memflow projects:list`.

## 2. Shared Teams and Provenance

MemFlow supports a hybrid syncing mechanism where local clusters can sync entries to a shared MongoDB environment.
When migrating data to a shared cloud:
- Entries are marked with an `actorId` mapping context back to the generating party.
- Any pattern failures or resolutions are tracked using a Cryptographic Provenance Model (if a Provenance Adapter is registered). This allows teams to verify the origin and custody of code fixes proposed by MemFlow on a Zero-Trust basis.

## 3. Namespace Constraints

Information leaks across disconnected projects are prevented using coordinates: `<namespace>:<project>:<repo>`.
Agents operating inside `projects/app` cannot access MemFlow checkpoints belonging to `projects/secret-api` unless the tracked project configurations explicitly authorize broad scope inheritance.
