---
name: tickle-stick
description: >
  Cost-hierarchy awareness for agent pipelines. When processing scheduled tasks,
  consider whether full agent processing is needed or if cheaper stages can
  handle it. Triggers: "cost optimization", "triage", "pipeline", "stages",
  "tickle-stick".
---

# tickle-stick — Agent Pipeline Awareness

You are operating in an environment with tickle-stick cost-hierarchy pipelines.
Before processing work items with expensive models, consider whether cheaper
stages can handle them.

## Cost Hierarchy

| Stage Type        | Cost    | When to use                                   |
| ----------------- | ------- | --------------------------------------------- |
| Script            | Free    | Fetch data, apply labels, run side effects    |
| Model (cheap)     | ~$0.001 | Classify items — routine / urgent / reasoning |
| Model (expensive) | ~$0.05+ | Complex reasoning, synthesis, drafting        |
| Callback          | Free    | Delivery, escalation — host decides           |

## Decision Framework

Before engaging expensive reasoning:

1. **Can a script handle it?** → Use a script stage (free, fast)
2. **Can a cheap model classify it?** → Use a cheap model stage (~$0.001)
3. **Does it need full reasoning?** → Use an expensive model stage (~$0.05+)

## Key Principle

> Cheap first, expensive only when justified.

Most work items don't need intelligence. Scripts and cheap models handle
60-80% of typical email/calendar/issue traffic. Expensive reasoning should
be reserved for items that actually need it.
