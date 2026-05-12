# MemFlow Deployment Scaling

MemFlow scales linearly from an isolated single-developer scratchpad to a massive distributed AI organization.

## 1. Scratchpad (SQLite)
By default, running MemFlow creates a `~/.memflow` config pointing to a local SQLite database.
- **Benefits:** Maximum privacy, zero latency, no setup, offline capabilities.
- **Drawbacks:** Does not share fixes or patterns across your engineering team.

## 2. Distributed Cloud (MongoDB)
When the team is ready to securely share cross-platform logic patterns, MemFlow connects cleanly by pointing the same logical model at MongoDB.
- Configure the connector with `MEMFLOW_CONNECTOR=mongodb`
- Set `MEMFLOW_MONGO_URI=<MONGODB_URI>`
- Set `MEMFLOW_MONGO_DATABASE=<database>`
- See the onboarding guide for the exact handoff: [`docs/internal-mongodb-onboarding.md`](./internal-mongodb-onboarding.md)
- All cached prompts, checkpoints, and patterns are now available to any agent operating across any workspace tied to the central namespace.

## 3. Managed Services
In scenarios where your application mandates strict Data Loss Prevention (DLP) filtering and rigid access topologies, Managed Service deployment adapters sit in front of MemFlow. Managed services wrap the core payloads with cryptographic signing and endpoint validations.
