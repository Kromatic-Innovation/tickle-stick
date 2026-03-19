# Config Schema Contract

## Purpose

Defines the YAML configuration format for tickle-stick. Config is loaded
at startup, validated with Zod, and passed to the interceptor.

## File resolution order

1. Path passed to `loadConfig(path)`
2. `./tickle-stick.yaml`
3. `./config/tickle-stick.yaml`

## Env var interpolation

Before Zod validation, the loader replaces `${VAR_NAME}` tokens with
`process.env.VAR_NAME`. Missing env vars → Zod validation error
(the field becomes `undefined`).

## Schema

```yaml
tickleStick:
  tier0:
    patterns:                    # Array of pattern rules
      - match: string            # Regex pattern or literal
        type: "regex" | "keyword" | "command"
        flags?: string           # Regex flags (e.g., "i", "gi")
        action: "deflect"        # Only deflect for Tier 0
        response: string         # Canned response text
    keywords:                    # Array of keyword groups
      - match: string[]          # Keywords to match (case-insensitive)
        action: "deflect"
        response: string

  tier1:
    systemPrompt: string         # Classification prompt
    confidenceThreshold: number  # 0-1, below this → escalate (default: 0.7)
    timeout: number              # ms (default: 5000)

  tier3:
    routes:                      # Array of escalation targets
      - channel: "webhook" | "email" | "slack"
        url?: string             # For webhook
        to?: string              # For email
        webhookUrl?: string      # For Slack

  telemetry:
    enabled: boolean             # default: true
    format: "json" | "text"      # default: "json"
    includeMessagePreview: boolean  # default: false (privacy)

```

> **Note:** Model provider configuration (API keys, model selection) is the host
> agent's responsibility. Inject a `TriageProvider` via the `Interceptor` constructor.

## Defaults

If no config file is found, `defaults.ts` provides a minimal working
config with:

- Tier 0: match "hi"/"hello"/"hey" → greeting
- Tier 1: disabled (no provider configured)
- Tier 3: console.log escalation (no routes)
- Telemetry: enabled, JSON format
