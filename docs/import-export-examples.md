# MemFlow Import/Export Specifications

MemFlow heavily leverages structured export bundles to transition workloads across isolated environments. Bundles wrap the data into a deterministically hashed JSON envelope.

## Exporting Memory
To export all memory entries within the currently executed namespace:

```bash
memflow sync:export --json > snapshot.json
```
This produces an array of MemoryEntries conforming strictly to `MemoryEntry` JSON schemas.

## Importing Memory
MemFlow supports importing legacy `ruflo` bundles, as well as native JSON ingestion logic. 
By deploying JSON payloads onto another machine, you preserve exact deterministic hashes, allowing local instances to recognize caching and checkpoint hits with 100% cache locality.

```bash
memflow migrate:ruflo --path /local/path/to/archive
```
