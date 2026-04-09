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
stages:
  - name: gather
    type: script
    command: "${FETCH_COMMAND}"
    args: ["${SCRIPT_PATH}"]
```

Missing env vars resolve to empty string (which may fail validation if the
field is required).

## Full Schema

```yaml
tickleStick:
  pipelines:
    my-pipeline:
      stages:
        - name: gather # Required: unique stage name
          type: script # script | model | callback
          command: "python3" # Script: command to run
          args: ["fetch.py"] # Script: command arguments (default: [])
          timeout: 30000 # Script/post-hook: timeout in ms (default: 30000)
          cwd: "/path" # Script: working directory (optional)

        - name: classify
          type: model
          provider: cheap # model: cheap (TriageProvider) or expensive (host callback)
          systemPrompt: "..." # cheap model: classification prompt
          confidenceThreshold: 0.7 # cheap model: below this → "needs-reasoning" (default: 0.7)

        - name: enrich # Piped script: input filter triggers stdin piping
          type: script
          command: "python3"
          args: ["enrich.py"]
          input: "classified:needs-reasoning" # Items piped to stdin as JSON
          timeout: 60000

        - name: reason
          type: model
          provider: expensive
          prompt: "{{items}}" # expensive model: prompt template (supports {{items}}, {{all_items}})
          input: "classified:needs-reasoning" # Input filter (optional, see below)

        - name: deliver
          type: callback # Host-provided function, keyed by stage name
          input: "all"

        # Any stage can have a post-hook:
        # postHook:
        #   command: "python3"
        #   args: ["apply-labels.py"]
        #   timeout: 15000       # default: 15000

  telemetry:
    enabled: true # default: true
    format: json | text # default: json

  budget:
    maxDailySpend: 1.00 # USD (optional)
    maxWeeklySpend: 5.00 # USD (optional)
    alerts:
      - at: "80%" # Percentage of daily/weekly limit
      - at: 0.50 # Absolute USD threshold
    retentionDays: 30 # Auto-prune events older than this (default: 30)
```

## Script Stage Modes

Script stages operate in two modes:

### Gather mode (default)

When a script stage has **no `input` filter**, it runs independently, fetches
data from external sources, and outputs `WorkItem[]` JSON on stdout. Output
items are appended to the pipeline context.

### Piped mode (with `input` filter)

When a script stage has an **`input` filter**, it receives filtered items from
prior stages on **stdin** as a JSON array. The script transforms or enriches
those items and outputs the result on stdout. Enriched items **replace** their
originals in the pipeline context (matched by `id`).

This enables post-classification enrichment without burning expensive model
tokens on data-fetching tool calls. See
[architecture.md](architecture.md#enrichment-pattern-piped-script-stages) for
the design rationale.

```yaml
# Piped script stage example: enrich items after classification
- name: enrich
  type: script
  command: "python3"
  args: ["scripts/enrich.py"]
  input: "classified:needs-reasoning,classified:urgent"
  timeout: 60000
```

The enrichment script reads JSON from stdin, adds context to each item's
`metadata`, and writes the enriched array to stdout.

## Input Filters

Control which items a stage sees:

| Filter                                         | Behavior                                 |
| ---------------------------------------------- | ---------------------------------------- |
| _(omitted)_                                    | All items from previous stages           |
| `all`                                          | All accumulated items (classified + raw) |
| `classified:routine`                           | Only items classified as routine         |
| `classified:needs-reasoning`                   | Only items needing reasoning             |
| `classified:urgent`                            | Only urgent items                        |
| `classified:urgent,classified:needs-reasoning` | Comma-separated union                    |

## Prompt Templates

Expensive model stages support template substitution:

- `{{items}}` — filtered input items (after applying the stage's `input` filter)
- `{{all_items}}` — all accumulated items from all previous stages

Both render as JSON arrays.

## Post-Hooks

Any stage can have a `postHook` that runs after the stage completes:

- Receives stage output on stdin as JSON
- Script stages: items array
- Model stages: model output text or classified items array
- Errors are logged but don't fail the pipeline

## Defaults

If no config file is found, tickle-stick uses empty defaults:

- No pipelines defined
- Telemetry: enabled, JSON format
- No budget tracking
