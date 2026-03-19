# Tickle-Stick Constitution

## Principles

1. **Cheap first, expensive only when justified.**
   Every inbound message starts at Tier 0 (free). It only escalates to a more
   expensive tier when cheaper tiers cannot resolve it. The default is deflection,
   not engagement.

2. **Declarative config for 90% of use cases, code escape hatch for the rest.**
   A YAML file should cover most deployments. Custom logic is possible via
   provider and tier hooks, but the framework should work out of the box.

3. **Model-agnostic: any provider, any model.**
   Tickle-stick does not prescribe a model vendor. The `TriageProvider` interface
   abstracts away the model layer. Ship with Anthropic and OpenAI providers;
   support Ollama and OpenRouter as optional.

4. **Telemetry is first-class — cost savings must be visible and provable.**
   Every tier decision is logged with tier, latency, estimated cost, and routing
   outcome. If you can't measure the savings, you can't prove the value.

5. **Ship the narrative, not just the code.**
   This project exists as much for thought leadership as for engineering. The
   README, blog post, and demo are as important as the code. Every artifact
   should tell the story: "you're wasting money on triage."
