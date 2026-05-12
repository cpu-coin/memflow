# Mobile Bridge Pattern

MemFlow is designed as a persistent, portable memory layer. One of its most powerful use cases is acting as a **Headless Communication Bus** between mobile applications and local AI agents.

This document outlines the standard pattern for building a mobile bridge on top of MemFlow.

## The Problem

Connecting a mobile phone to a local IDE agent (like Cursor or Claude Code) traditionally requires:
1. Reverse-engineering Chrome DevTools Protocol (CDP) ports.
2. Granting broad Accessibility permissions to inject keystrokes (AppleScript/UIAutomation).
3. Leaving the IDE window open and in focus.

## The MemFlow Solution

By using MemFlow as the intermediary, you can completely decouple the mobile UI from the IDE. The agent and the mobile app simply read and write to the same local SQLite database (`~/.memflow/memflow.sqlite`).

### Architecture

1. **Mobile App to MemFlow (Inbox)**
   - The mobile bridge server receives a message from the phone via HTTP/WebSocket.
   - The bridge writes the message to MemFlow using the `ag_bridge/inbox` (or custom) namespace.
   - The entry is tagged with `pending` and `mobile`.

2. **Agent Reads the Inbox**
   - The local AI agent is equipped with a custom MCP tool (e.g., `memflow_inbox`) or uses the standard `memory_search` tool.
   - The agent queries MemFlow for entries in the inbox namespace with the `pending` tag.
   - The agent executes the user's request.

3. **Agent Responds (Outbox)**
   - The agent formulates a response and uses `memory_store` (or a custom `memflow_reply` tool) to write to the `ag_bridge/outbox` namespace.
   - The response is tagged `unread`.
   - The agent updates the original inbox message, changing its tag from `pending` to `read`.

4. **MemFlow to Mobile App**
   - The mobile bridge server runs a background polling loop (e.g., every 5 seconds).
   - It queries the MemFlow database directly for `unread` entries in the outbox.
   - When found, it broadcasts them to the mobile app via WebSocket and updates their tags to `read`.

## Recommended MCP Tools for Agents

If you are building a custom MCP server for your agent, it is highly recommended to expose dedicated bridge tools to simplify the LLM's prompt surface:

* `memflow_inbox`: Retrieves `pending` messages from the inbox namespace.
* `memflow_ack`: Marks specified messages as `read`.
* `memflow_reply`: Writes a new entry to the outbox namespace with the `unread` tag.

These tools abstract the raw `memory_store` and `memory_search` queries, ensuring the tags and namespaces are always correct.

## Benefits

- **Zero IDE Dependency**: The agent can run entirely in the background (headless terminal, background service, etc.).
- **Reliability**: If the mobile app disconnects or the agent crashes, no messages are lost. The MemFlow database retains the exact state.
- **Security**: No open CDP ports or keystroke injection required. The system is sandboxed to database reads and writes.
