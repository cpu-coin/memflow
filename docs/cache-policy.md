# MemFlow Cache Policy (Agents + CI)

Purpose: maximize reuse while avoiding accidental cache bloat.

## Defaults
- Automatic cache store on `agent:finalize` when both `prompt` and `output` are present and output length ≤ 8,000 chars.
- Override with `MEMFLOW_AUTO_CACHE_MAX_CHARS=<int>` if you want larger or smaller entries.
- Session / compaction remain unchanged.

## Recommended agent behavior
- Always call `agent:prepare` at the start of an objective, `agent:finalize` at the end.
- Before re-asking a question, call `cache:auto:get --task <slug> --prompt "<prompt>”`.
- After producing a reusable answer, call `cache:auto:store --task <slug> --prompt "<prompt>" --content "<answer>"` if `finalize` didn’t already store it (e.g., long outputs beyond the length cap).
- Use stable `task` names per feature/PR for higher hit rates.

## CI hooks
- Pre-step: `memflow agent:prepare --sessionId ci-$GIT_SHA --goal "CI run" --prompt "$CI_JOB_NAME"`.
- Post-step: `memflow agent:finalize --sessionId ci-$GIT_SHA --goal "CI run" --summary "$(cat summary.txt)" --files "$(git diff --name-only)"`.
- To pin key build instructions, store them once: `memflow cache:auto:store --task build-hardening --prompt "build hardening" --content "$(cat BUILD_NOTES.md)"`.

## Cloud provider caches vs MemFlow
- Keep MemFlow cache on (team-shared, scoped to repo/project/workspace, deterministic).
- Cloud LLM caches (if available) can reduce per-call latency but are provider-specific and non-portable. Use both when you trust the provider’s tenancy/isolation; MemFlow remains the canonical shared cache.
