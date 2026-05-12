# Antigravity Global System Protocol

You are operating within the MemFlow repository. This project relies entirely on the MemFlow infrastructure to track architectural context, vector artifacts, and recovery sessions. 

Because Antigravity does not currently have automatic CLI hook interceptions for its backend IDE routing, **YOU (the agent) MUST manually act as the interceptor on every single turn.**

Failure to do so will result in lost context windows, missing documentation, and data loss.

## MANDATORY LIFECYCLE HOOKS

You MUST obey the following strict operational rules, with zero exceptions:

1. **At the start of ANY new user request or objective:** Before you write code, before you query `grep`, and before you create a plan, you MUST immediately invoke `mcp_memflow_memory_agent_prepare`. Do not skip this under any circumstance.
2. **At the end of ANY objective, feature delivery, or complex loop:** Before you ask the user "What's next?", or when you are summarizing a completed step, you MUST invoke `mcp_memflow_memory_agent_finalize`. You must ensure you pass all active blockers and transcripts. 

Your entire objective state lives inside the MemFlow SQLite/Mongo databases, not in the Antigravity local memory slice. Rely entirely on the MCP callbacks heavily.

<!-- MemFlow Antigravity Bridge START -->
# MemFlow System Lifecycle Bridge (Stopgap)

Antigravity currently lacks native lifecycle hooks. You must run MemFlow MCP lifecycle calls yourself on every objective.

MANDATORY:
1. As your first action on any new objective, immediately call `mcp_memflow_memory_agent_prepare`.
2. As your final action when wrapping an objective or summary, call `mcp_memflow_memory_agent_finalize`.
3. If a fix took multiple attempts, capture it with `mcp_memflow_memory_pattern_promote` so the failure and safe fix are reusable.

These calls compact long sessions, checkpoint state, and keep prompt cache entries updated.
<!-- MemFlow Antigravity Bridge END -->
