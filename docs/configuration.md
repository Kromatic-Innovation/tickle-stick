# Configuration

## Config File

Tickle-stick looks for config in this order:

1. Explicit path passed to `loadConfig(path)`
2. `./tickle-stick.yaml`
3. `./config/tickle-stick.yaml`

## Environment Variables

Use `${VAR_NAME}` syntax in YAML values. Variables are interpolated before
schema validation.

```yaml
tier0:
  patterns:
    - match: "^hello$"
      type: regex
      action: deflect
      response: "${GREETING_RESPONSE}"
```

Missing env vars resolve to empty string (which may fail validation if the
field is required).

## Full Schema

```yaml
tickleStick:
  tier0:
    patterns: # Pattern rules (checked in order)
      - match: "^hello$" # Pattern string
        type: regex | keyword | command
        flags: "i" # Regex flags (optional)
        action: deflect # Only "deflect" for Tier 0
        response: "Hello!" # Response text
    keywords: # Keyword groups
      - match: ["unsub", "stop"] # Keywords (case-insensitive)
        action: deflect
        response: "Done."

  tier1: # Optional — omit to disable Tier 1
    systemPrompt: "..." # Classification prompt
    confidenceThreshold: 0.7 # Below this → escalate (default: 0.7)
    timeout: 5000 # ms (default: 5000)

  # Tier 3 (human escalation) is decision-only — no config needed.
  # When the TierResult has action: "human", the host handles dispatch
  # (email, Slack, webhook) through its own infrastructure.

  telemetry:
    enabled: true # default: true
    format: json | text # default: json
    includeMessagePreview: false # default: false (privacy)
```

> **Note:** Tier 1 model configuration (provider, model, API keys) is the host's
> responsibility. Pass a `TriageProvider` implementation to the `Interceptor`
> constructor. Tier 3 dispatch (email, Slack, webhook) is also the host's
> responsibility — tickle-stick returns the decision, the host acts on it.

## Pattern Types

| Type      | Behavior                                                       |
| --------- | -------------------------------------------------------------- |
| `regex`   | Tested against message body with `new RegExp(match, flags)`    |
| `command` | Exact match or prefix match (e.g., `/help` matches `/help me`) |
| `keyword` | Case-insensitive substring search in message body              |

Patterns are checked in array order. First match wins.

## Defaults

If no config file is found, tickle-stick uses sensible defaults:

- Tier 0: greetings (`hi/hello/hey`) and `/help` command
- Tier 1: disabled (no provider)
- Telemetry: enabled, JSON format
