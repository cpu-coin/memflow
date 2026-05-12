# Ops Metrics & Effectiveness Loop

Goal: continuously validate that MemFlow reduces time/token spend and spot regressions early.

## What to track (daily snapshots)
- Cache hit / miss counts
- Session resume hits and compacted resume hits
- Compactions executed
- Automatic cache stores vs skipped (length cap)
- Connector ping latency
- Totals per repo/project/workspace

## How to collect
- Schedule `memflow metrics --json` and store snapshots (e.g., in Mongo, BigQuery, or flat files).
- Optional: capture `memflow status --json` to watch connector health and ping.

## Dashboards (example)
- Hit-rate % over time (cache_hit / (cache_hit + cache_miss))
- Session resume hits vs finalize count
- Compaction count vs agent_finalize
- Ping latency trend per region
- Miss reasons: track when auto-cache skipped due to length cap

## Alerts (rules of thumb)
- Cache miss > 2× hit for a repo/day → suggest enabling/encouraging `cache:auto:store` and stable task names.
- Session resume hits near zero but finalize high → encourage stable sessionIds per branch/PR.
- Connector ping > 200ms sustained → move Mongo closer or add edge/read replica.
- Compactions drop to zero → check host hooks (prepare/finalize) are firing.

## Agent/CI tips to improve hit rate
- Always `agent:prepare` at start and `agent:finalize` at end.
- Use stable `sessionId` (branch/PR slug) and `task` names.
- Before repeating a prompt: `memflow cache:auto:get --task <slug> --prompt "<prompt>"`.
- After producing a reusable answer: `memflow cache:auto:store ...` (or rely on auto-store when output is under the length cap).

## Edge/offload idea
Place read-heavy recall/cache lookups on a nearby edge/replica while writes go to primary. Reduces latency and energy per request.
