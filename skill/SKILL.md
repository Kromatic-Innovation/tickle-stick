---
name: tickle-stick-routine-design
description: >
  Design and implement cost-optimized tickle-stick pipelines. Use when creating
  new automated routines, optimizing existing pipelines, or wiring up scheduled
  tasks with the tickle-stick cost hierarchy.
user-invocable: true
---

# Tickle-Stick Routine Design

Use this skill to design, build, and wire up tickle-stick pipelines — the
cost-hierarchy system that runs cheap stages before committing expensive
intelligence.

## Core Principle

> Cheap first, expensive only when justified.

60-80% of typical work items (emails, calendar events, issues) don't need
intelligence. Scripts and cheap models handle them. Expensive reasoning is
reserved for items that actually need it.

## Cost Hierarchy

| Tier | Stage Type        | Cost    | Latency | Use For                             |
| ---- | ----------------- | ------- | ------- | ----------------------------------- |
| 0    | Script            | $0      | <50ms   | Fetch data, filter, apply labels    |
| 1    | Model (cheap)     | ~$0.001 | <2s     | Classify: routine / urgent / reason |
| 2    | Model (expensive) | ~$0.05+ | 5-30s   | Reason, synthesize, draft responses |
| 3    | Callback          | $0      | varies  | Deliver, escalate, send alerts      |

## Designing a Pipeline

### Step 1: Identify the data source

Every pipeline starts with a gather stage (Tier 0 script) that fetches raw
data. This is free and deterministic.

- What data source? (Gmail, Calendar, GitHub, RSS, database)
- What wrapper script exists? (check the project's own `scripts/` directory or your workspace's local scripts directory)
- What's the output format? Must be `WorkItem[]` JSON on stdout
- What dedup mechanism? (labels, timestamps, database flags)

**Critical:** If the gather script returns `[]`, the pipeline stops
immediately with $0 cost. Design gather scripts to be aggressive about
filtering already-processed items.

### Step 2: Decide what's deterministic

Before involving any model, ask:

- Can I filter items with simple rules? (regex, labels, sender lists)
- Can I apply side effects without reasoning? (auto-archive spam domains)
- Can I call external APIs for data? (Google Maps, GitHub API)

Put all of this in the gather script or a post-hook. Every item handled
here saves ~$0.05 in model costs.

### Step 3: Design the classify stage (Tier 1)

The cheap model classifies items into categories. Common patterns:

| Classification         | Meaning                                   |
| ---------------------- | ----------------------------------------- |
| `routine`              | Handled by post-hook, no reasoning needed |
| `needs-reasoning`      | Promote to expensive model                |
| `urgent`               | Promote AND alert immediately             |
| `needs-classification` | Ambiguous, model needs more context       |
| `spam`                 | Filter out, apply label                   |

**Key settings:**

- `confidenceThreshold`: Below this, auto-escalate to Tier 2. Default 0.7.
  Set higher (0.8-0.9) for safety-critical decisions, lower (0.5-0.6) for
  low-stakes classification.
- `systemPrompt`: Instructions for the classifier. Use `$file:` references
  for prompts stored in files.
- `postHook`: Script that runs after classification (e.g., apply labels to
  items classified as spam/routine).

### Step 4: Design the reason stage (Tier 2)

Only items that pass the `input` filter reach here. This is where expensive
intelligence does real work:

- Draft responses, synthesize reports, resolve conflicts
- `input: "classified:needs-reasoning,classified:urgent"` filters to only
  items the classifier couldn't handle
- `prompt`: Detailed instructions with `{{items}}` placeholder
- `postHook`: Apply results (create drafts, update records)

### Step 5: Design post-deliver (Tier 3)

Callback stage for side effects that need TypeScript/host context:

- Send Slack/chat messages
- Update databases
- Trigger other pipelines

Register callbacks in `src/task-scheduler.ts` using the closure pattern.

## YAML Configuration Reference

```yaml
tickleStick:
  budget:
    maxDailySpend: 1.00 # USD hard cap
    maxWeeklySpend: 5.00
    alerts:
      - at: "80%" # percentage of limit
      - at: 0.50 # absolute USD
    retentionDays: 30

  pipelines:
    my-pipeline:
      stages:
        # Tier 0: Gather data (free)
        - name: gather
          type: script
          command: "python3"
          args: ["scripts/my-gather.py"]
          timeout: 30000 # ms, default 30s

        # Tier 1: Classify (cheap)
        - name: classify
          type: model
          provider: cheap
          systemPrompt: "$file:config/prompts/my-classify.md"
          confidenceThreshold: 0.8
          input: "all" # or omit for all items
          postHook:
            command: "python3"
            args: ["scripts/my-post-classify.py"]

        # Tier 2: Reason (expensive)
        - name: reason
          type: model
          provider: expensive
          input: "classified:needs-reasoning,classified:urgent"
          prompt: "$file:config/prompts/my-reason.md"
          postHook:
            command: "python3"
            args: ["scripts/my-post-reason.py"]

        # Tier 3: Deliver (callback)
        - name: post-deliver
          type: callback
```

## WorkItem Schema

Gather scripts must output this JSON array to stdout:

```json
[
  {
    "id": "source-unique-id",
    "source": "gmail|calendar|github|...",
    "type": "email|event|issue|...",
    "summary": "One-line human-readable summary",
    "body": "Full content or snippet",
    "metadata": {},
    "timestamp": "ISO 8601"
  }
]
```

## Input Filtering

The `input` field on model stages controls which items reach the model:

| Value                                            | Items processed                     |
| ------------------------------------------------ | ----------------------------------- |
| `"all"` or omitted                               | All items from previous stages      |
| `"classified:needs-reasoning"`                   | Only items with that classification |
| `"classified:urgent,classified:needs-reasoning"` | Multiple classifications (OR)       |

## Post-Hook Scripts

Post-hooks receive stage output on stdin (JSON) and run side effects:

```python
#!/usr/bin/env python3
import json, sys

stdin_data = sys.stdin.read().strip()
items = json.loads(stdin_data)  # or extract JSON array from text

for item in items:
    # Apply labels, create drafts, call APIs...
    pass
```

- Errors don't fail the pipeline (graceful degradation)
- Default timeout: 15s
- Log to stderr, not stdout

## File References

Use `$file:path/to/file.md` in YAML string values to load file contents
at config parse time. Paths are relative to the YAML file location.

```yaml
systemPrompt: "$file:config/prompts/my-classify.md"
```

This keeps prompts out of the YAML and enables gitignoring personal content.

## Prompt Design

### Classify prompts (Tier 1)

- Short and directive — cheap models have small context windows
- Define clear classification categories
- Request JSON output: `{"classification": "...", "confidence": 0.0-1.0}`
- Include examples of each category

### Reason prompts (Tier 2)

- Can be longer and more nuanced
- Use `{{items}}` placeholder for the filtered items
- Define output format explicitly (JSON array)
- Include persona/role context if applicable

## Wiring a Pipeline to a Host Scheduler

### 1. Add schedule config:

```yaml
myPipeline:
  enabled: true
  cron: "0 8 * * *" # 8 AM daily
```

### 2. Add sync function:

Read config, find the control group, create/update a cron task with
`prompt: 'pipeline:my-pipeline'`.

### 3. Add dispatch branch:

Register `stageCallbacks` for model and callback stages.

**Closure pattern** for passing data between stages:

```typescript
let reasonOutput = "";
stageCallbacks["reason"] = async (items, prompt) => {
  reasonOutput = await processTier2Direct(items, prompt);
  return reasonOutput;
};
stageCallbacks["post-deliver"] = async () => {
  // Access reasonOutput from closure
  return "";
};
```

## Design Patterns

### Run often, classify cheaply

For continuous monitoring (email, alerts), run the gather every 5 minutes.
If nothing new, pipeline stops at Tier 0 ($0). When items arrive, cheap
classification handles most of them. Only novel/complex items hit Tier 2.

### Daily synthesis

Gather summaries of what happened, skip classification, go straight to
an expensive model synthesis stage. Good for briefings, retros, reports.

### Phased orchestration

For complex workflows (repo maintenance), split into multiple pipelines
that run in sequence: triage, plan, execute, report.

### Idempotency via tagging

Use source-specific labels or tags to mark processed items:

- Gmail: `claw/triaged`, `claw/drafted`, `claw/spam`
- Calendar: `[claw/travel]` in event description
- GitHub: labels on issues/PRs

The gather script filters out already-tagged items, preventing duplicates.

## Cost Estimation

Before building a pipeline, estimate daily cost:

```
items_per_day = N
pct_filtered_tier0 = 60-80%     # filtered by script
pct_classified_tier1 = 80-90%   # handled by cheap model
pct_reasoning_tier2 = 10-20%    # need expensive model

daily_cost = N * (1 - pct_filtered_tier0) * $0.001       # classify
           + N * (1 - pct_filtered_tier0)
               * (1 - pct_classified_tier1) * $0.05      # reason
```

Example: 20 emails/day, 70% filtered, 85% classified = ~$0.05/day

## Guardrails

- **DO** start with the gather script — highest ROI investment
- **DO** set budget caps to prevent runaway costs
- **DO** use `$file:` references for prompts (keeps YAML clean, enables gitignore)
- **DO** log to stderr in post-hook scripts, never stdout
- **DO** make gather scripts idempotent (filter already-processed items)
- **DO NOT** skip Tier 0 and go straight to models
- **DO NOT** use expensive models for classification
- **DO NOT** put personal/private content in `tickle-stick.yaml` if the repo is public
- **DO NOT** have post-hooks fail the pipeline — log errors and continue
