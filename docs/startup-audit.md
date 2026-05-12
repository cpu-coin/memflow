# Startup Audit

This note tracks the first-run path from a user’s point of view.

## What A New User Should See

1. Install dependencies.
2. Run `memflow init` to walk through projects, automation, and the IDE / CLI / CI surfaces they want to enable. In an interactive shell, it should continue into quickstart automatically.
3. Run `memflow quickstart` later only if they want to rerun the repo bootstrap for a different workspace.
4. Run `npm link`, `pnpm link --global`, or `yarn link` only if they want the command available everywhere on the machine.

## What The App Enforces

- Fresh installs without a completed onboarding state are routed into the guided setup instead of skipping straight to repo automation.
- The guided setup is the top-level CPUcoin / MemFlow startup flow, not just a repo seed step.
- Successful interactive init should continue into quickstart instead of stopping at the wizard, and quickstart should seed recovery/persona defaults for the repo.
- `memflow doctor` reports whether onboarding was completed.
- The quickstart guide now explains the `init` first, automatic handoff to `quickstart` second flow.

## What The User Needs From Us

- One clear command for first-run setup: `memflow init`
- A follow-up command only when they want to rerun repo bootstrap: `memflow quickstart`
- Clear host integration commands for the IDE or CLI they actually use
- Alias commands for the major coding clients, including `connect:openai`, `connect:chatgpt`, and `connect:claude`
- A remote MCP endpoint path for ChatGPT / OpenAI desktop via `memflow mcp --transport httpStream --port <n>`
- A system-wide link command only when they want a global binary
- A dedicated ChatGPT / OpenAI desktop guide at `docs/chatgpt-openai-desktop.md`

## Remaining Gaps To Watch

- We still rely on the user to run the first command after install, so the documentation and startup message have to stay prominent.
- Non-TTY environments should not try to launch the guided wizard; they should point the user at `memflow init` instead.
- When a host integration is installed, the CLI should say whether MemFlow is on and connected or whether the host needs a reload before it becomes live.
