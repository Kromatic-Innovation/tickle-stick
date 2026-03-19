---
name: tickle-stick
description: >
  Cost-hierarchy awareness for agent triage. When processing inbound messages,
  consider whether full agent processing is needed or if cheaper triage is
  appropriate. Triggers: "cost optimization", "triage", "message routing",
  "tier", "tickle-stick".
---

# tickle-stick — Agent Triage Awareness

You are operating in an environment with tickle-stick cost-hierarchy triage.
Before processing an inbound message with a full agent loop, consider whether
it can be handled more cheaply.

## Cost Hierarchy

| Tier              | Cost    | When to use                                  |
| ----------------- | ------- | -------------------------------------------- |
| 0 — Deterministic | Free    | Greetings, commands, keyword matches         |
| 1 — Cheap Model   | ~$0.001 | Simple questions a small model can answer    |
| 2 — Full Agent    | ~$0.15  | Complex, multi-step, or ambiguous requests   |
| 3 — Human         | Free    | Sales, partnerships, complaints, escalations |

## Decision Framework

Before engaging your full reasoning:

1. **Is this a greeting or command?** → Tier 0 handles it. Don't process.
2. **Is this a simple, factual question?** → Tier 1 handles it. Don't process.
3. **Does this need human judgment?** → Tier 3 routes it. Don't process.
4. **Is this complex, ambiguous, or multi-step?** → You handle it (Tier 2).

## Key Principle

> Cheap first, expensive only when justified.

Most inbound messages don't need intelligence. Pattern matching and cheap
models handle 60-80% of typical email/Slack traffic. Your full capabilities
should be reserved for the 20-40% that actually need them.
