# MemFlow Security Model

## Security Posture

MemFlow is a reduced-scope local-first product. Its security comes from refusing to expose broad functionality, and from actively scanning content at the MCP boundary before it reaches persistent storage or third-party AI providers.

## Required Defaults

- bind localhost by default
- fixed MCP tool allowlist
- no shell execution
- no browser automation
- no autonomous loops
- no dynamic remote MCP connectors
- strict schema validation on every write/import
- import/export audit trail
- **runtime security sweep on all write operations** (enabled by default, `warn` level)

## Allowed MCP Tool Families

- memory CRUD
- prompt-cache read/write
- import/export/merge
- stats and health

## Disallowed Tool Families

- shell / terminal
- browser / web automation
- workflow execution
- swarm / hive / coordination
- agent spawn / stop / list
- arbitrary GitHub integration
- remote search / research / scraping
- code execution

## Security Sweep Engine

MemFlow includes a built-in **Security, Confidentiality, and Privacy Sweep** that inspects all write-tool payloads at the MCP boundary before they are stored locally, written to shared MongoDB, or passed through an agent session.

### What It Detects

| Category | Examples |
|---|---|
| Private Keys | PEM private keys, OPENSSH, RSA, EC |
| API Keys | OpenAI `sk-proj-*`, Anthropic `sk-ant-*`, Google `AIzaSy*`, AWS `AKIA*`, Stripe `sk_live_*`, Slack `xox*`, GitHub `ghp_*` |
| Database Passwords | `mongodb://user:PASS@host`, `postgres://user:PASS@host` |
| PII (opt-in) | Email addresses, SSNs, credit card numbers |
| Custom Patterns | User-defined regex patterns via `securitySweep.customPatterns` |

### Enforcement Levels

| Level | Behavior |
|---|---|
| `warn` (default) | Stores content but includes a `_securityWarnings` field in the tool response so the agent sees the risk |
| `redact` | Automatically replaces sensitive values with `[REDACTED_...]` placeholders before storage |
| `block` | Rejects the request entirely with a `SecuritySweepBlockError` |

### Scope

The sweep only runs on **write tools** to avoid false positives on read/search operations:

- `memory_store`, `memory_profile_store`, `memory_cache_store`, `memory_cache_auto_store`
- `memory_session_checkpoint`, `memory_session_compact`, `memory_agent_finalize`
- `memory_pattern_promote`, `memory_import`, `memory_merge`

Read-only tools (`memory_search`, `memory_list`, `memory_retrieve`, `memory_export`, etc.) are **not swept** — scanning query strings for secrets would produce false positives (e.g. searching for `user@company.com` would trigger an email warning).

### Configuration

Control sweep behavior via CLI or config file:

```bash
memflow security:sweep                      # Show current settings
memflow security:sweep:enable               # Enable sweep
memflow security:sweep:disable              # Disable sweep
memflow security:sweep:level --level redact # Change enforcement level
memflow security:sweep:rules --pii on       # Enable PII detection
memflow security:sweep:rules --api-keys off # Disable API key detection
```

Or edit `~/.memflow/config.json` directly:

```json
{
  "securitySweep": {
    "enabled": true,
    "level": "warn",
    "rules": {
      "privateKeys": true,
      "apiKeys": true,
      "databaseUris": true,
      "pii": false
    },
    "customPatterns": [
      { "name": "Internal Token", "regex": "CORP-TOKEN-[A-Z0-9]{16}" }
    ]
  }
}
```

### Bypass

Agents or users with legitimate need to store sensitive content (e.g., storing a redacted credential reference deliberately) can bypass the sweep for a single request:

```json
{ "metadata": { "bypassSecuritySweep": true } }
```

Or via `coordinates`:

```json
{ "coordinates": { "namespace": "...", "scope": "workspace", "bypassSecuritySweep": true } }
```

Bypass requests are always logged to stderr with a `[SECURITY SWEEP BYPASSED]` notice. They are never silently ignored.

## Threat Model Priorities

- accidental exposure of non-memory tools
- unbounded or recursive agent/tool loops
- hidden cost generation
- unsafe import payloads
- namespace escape between repos/teams
- stale or unverifiable memory poisoning
- **private credential round-trip to third-party AI providers**

## Release Gate

MemFlow should not publish until these checks pass:

- MCP tool inventory reviewed
- dependency inventory reviewed
- remnant code scan completed
- secret scan completed
- import fuzz tests completed
- namespace isolation tests completed
- deterministic merge tests completed
- security sweep unit tests passing

## Trust Model

Shared memory entries must support:

- provenance
- confidence
- freshness
- source identification
- reversible export/import

MemFlow should prefer explicit trust signals over implicit magic.
