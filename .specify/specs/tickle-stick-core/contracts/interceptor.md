# Interceptor Pipeline Contract

## Purpose

The interceptor orchestrates sequential message routing through the 4-tier
cost hierarchy. It is the single entry point for all inbound messages.

## Interface

```typescript
interface InterceptorConfig {
  tiers: {
    tier0: Tier0Config;
    tier1: Tier1Config;
    tier3: Tier3Config;
  };
  telemetry: TelemetryConfig;
  providers: ProvidersConfig;
}

interface Interceptor {
  /**
   * Process an inbound message through the tier pipeline.
   * Returns the result from whichever tier handled the message.
   */
  process(message: InboundMessage): Promise<TierResult>;
}
```

## Behavior

1. Receive `InboundMessage`
2. Run Tier 0 (deterministic). If match → return `TierResult` with `tier: 0`
3. Run Tier 1 (cheap triage). Based on decision:
   - `"deflect"` → return `TierResult` with `tier: 1`
   - `"human"` → run Tier 3, return `TierResult` with `tier: 3`
   - `"escalate"` → return `TierResult` with `tier: 2, action: "passthrough"`
4. Emit telemetry event for every processed message

## Error contract

- Tier 0 error → log warning, continue to Tier 1
- Tier 1 error → log warning, fall through to Tier 2 (passthrough)
- Tier 3 error → log error, return result with error metadata
- Never throw from `process()` — always return a `TierResult`

## Telemetry event

Every `process()` call emits a structured log entry:

```json
{
  "event": "tickle_stick.process",
  "messageId": "...",
  "channel": "email",
  "tier": 0,
  "action": "deflect",
  "latencyMs": 3,
  "costEstimate": 0,
  "timestamp": "2026-03-19T..."
}
```
